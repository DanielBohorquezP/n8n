#!/usr/bin/env node
import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const SHEET_HEADERS = [
	'Business Name',
	'CEO/Director Name',
	'CEO/Director LinkedIn Profile URL',
	'Company Website',
	'Company LinkedIn Profile URL',
	'Country',
	'City',
];

function parseArgs(argv) {
	const args = {};
	for (let i = 2; i < argv.length; i++) {
		const token = argv[i];
		if (!token.startsWith('--')) continue;
		const [key, value] = token.slice(2).split('=');
		if (value !== undefined) args[key] = value;
		else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
			args[key] = argv[i + 1];
			i++;
		} else {
			args[key] = 'true';
		}
	}
	return args;
}

function normalizeValue(value) {
	return String(value ?? '')
		.trim()
		.toLowerCase();
}

function extractNameFromTitle(title) {
	const [nameBlock] = String(title || '').split('-');
	const cleaned = nameBlock.replace(/\|.*/, '').trim();
	const parts = cleaned.split(/\s+/).filter(Boolean);
	if (parts.length === 0) return { fullName: '', firstName: '', lastName: '' };
	return {
		fullName: parts.join(' '),
		firstName: parts[0],
		lastName: parts.slice(1).join(' '),
	};
}

function isLinkedInProfileUrl(url) {
	return /linkedin\.com\/(in|pub)\//i.test(url || '');
}

function getDomainFromSnippet(snippet) {
	const match = String(snippet || '').match(/([a-z0-9-]+\.)+[a-z]{2,}/i);
	return match ? `https://${match[0].toLowerCase()}` : '';
}

function createQueries(profile) {
	const titles = profile.targetRoles?.length ? profile.targetRoles : ['CEO'];
	const keywords = profile.keywords?.length ? profile.keywords.join(' ') : '';
	const base = [profile.industry, profile.country, profile.city, keywords]
		.filter(Boolean)
		.join(' ')
		.trim();
	return titles.map((title) => `site:linkedin.com/in \"${title}\" ${base}`.trim());
}

async function googleSearch(query, serpApiKey) {
	const url = new URL('https://serpapi.com/search.json');
	url.searchParams.set('engine', 'google');
	url.searchParams.set('q', query);
	url.searchParams.set('num', '20');
	url.searchParams.set('api_key', serpApiKey);

	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`SERP API request failed (${response.status}): ${await response.text()}`);
	}

	const payload = await response.json();
	return payload.organic_results ?? [];
}

function mapSearchResultToLead(result, profile) {
	const profileUrl = result.link || '';
	if (!isLinkedInProfileUrl(profileUrl)) return null;

	const name = extractNameFromTitle(result.title || '');
	const companyName = String(result.title || '')
		.split('-')
		.slice(1)
		.join('-')
		.replace(/linkedin/i, '')
		.trim();

	const snippet = String(result.snippet || '');
	const lead = {
		businessName: companyName,
		decisionMakerName: name.fullName,
		decisionMakerLinkedInUrl: profileUrl,
		companyWebsite: getDomainFromSnippet(snippet),
		companyLinkedInUrl: '',
		country: profile.country ?? '',
		city: profile.city ?? '',
	};

	if (!lead.businessName || !lead.decisionMakerName) return null;
	return lead;
}

function deduplicateLeads(leads) {
	const map = new Map();
	for (const lead of leads) {
		const key = normalizeValue(lead.decisionMakerLinkedInUrl);
		if (!key) continue;
		if (!map.has(key)) map.set(key, lead);
	}
	return [...map.values()];
}

function base64UrlEncode(input) {
	return Buffer.from(input)
		.toString('base64')
		.replace(/=/g, '')
		.replace(/\+/g, '-')
		.replace(/\//g, '_');
}

function createSignedJwt(serviceAccount, scope) {
	const now = Math.floor(Date.now() / 1000);
	const header = { alg: 'RS256', typ: 'JWT' };
	const payload = {
		iss: serviceAccount.client_email,
		scope,
		aud: 'https://oauth2.googleapis.com/token',
		exp: now + 3600,
		iat: now,
	};
	const encodedHeader = base64UrlEncode(JSON.stringify(header));
	const encodedPayload = base64UrlEncode(JSON.stringify(payload));
	const unsigned = `${encodedHeader}.${encodedPayload}`;
	const signer = createSign('RSA-SHA256');
	signer.update(unsigned);
	signer.end();
	const signature = signer.sign(serviceAccount.private_key);
	return `${unsigned}.${base64UrlEncode(signature)}`;
}

async function getGoogleAccessToken(serviceAccount) {
	const assertion = createSignedJwt(
		serviceAccount,
		'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file',
	);
	const body = new URLSearchParams({
		grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
		assertion,
	});
	const response = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body,
	});
	if (!response.ok) {
		throw new Error(`Unable to get Google access token (${response.status}): ${await response.text()}`);
	}
	const payload = await response.json();
	return payload.access_token;
}

async function googleApiFetch(url, token, options = {}) {
	const response = await fetch(url, {
		...options,
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
			...(options.headers || {}),
		},
	});
	if (!response.ok) {
		throw new Error(`Google API request failed (${response.status}): ${await response.text()}`);
	}
	return response.json();
}

async function createSpreadsheet(token, title) {
	const payload = {
		properties: { title },
		sheets: [{ properties: { title: 'Leads' } }],
	};
	return googleApiFetch('https://sheets.googleapis.com/v4/spreadsheets', token, {
		method: 'POST',
		body: JSON.stringify(payload),
	});
}

async function getRows(token, spreadsheetId) {
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Leads!A:G`;
	return googleApiFetch(url, token);
}

function leadToRow(lead) {
	return [
		lead.businessName,
		lead.decisionMakerName,
		lead.decisionMakerLinkedInUrl,
		lead.companyWebsite,
		lead.companyLinkedInUrl,
		lead.country,
		lead.city,
	];
}

async function appendRows(token, spreadsheetId, rows) {
	if (rows.length === 0) return;
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Leads!A:G:append?valueInputOption=RAW`;
	await googleApiFetch(url, token, {
		method: 'POST',
		body: JSON.stringify({ values: rows }),
	});
}

async function updateRow(token, spreadsheetId, rowNumber, row) {
	const range = `Leads!A${rowNumber}:G${rowNumber}`;
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=RAW`;
	await googleApiFetch(url, token, {
		method: 'PUT',
		body: JSON.stringify({ values: [row] }),
	});
}

function indexExistingRows(values = []) {
	const index = new Map();
	for (let i = 1; i < values.length; i++) {
		const row = values[i];
		const linkedInUrl = normalizeValue(row[2]);
		if (!linkedInUrl) continue;
		index.set(linkedInUrl, { rowNumber: i + 1, row });
	}
	return index;
}

async function syncLeadsToSheet(token, spreadsheetId, leads) {
	const existing = await getRows(token, spreadsheetId);
	const values = existing.values ?? [];
	const hasHeader = values[0]?.join('|') === SHEET_HEADERS.join('|');
	if (!hasHeader) {
		await appendRows(token, spreadsheetId, [SHEET_HEADERS]);
	}
	const currentRows = hasHeader ? values : [SHEET_HEADERS, ...values];
	const rowIndex = indexExistingRows(currentRows);
	const toAppend = [];
	let updated = 0;

	for (const lead of leads) {
		const key = normalizeValue(lead.decisionMakerLinkedInUrl);
		const row = leadToRow(lead);
		const existingRow = rowIndex.get(key);
		if (!existingRow) {
			toAppend.push(row);
			continue;
		}
		if (existingRow.row.join('|') !== row.join('|')) {
			await updateRow(token, spreadsheetId, existingRow.rowNumber, row);
			updated++;
		}
	}

	await appendRows(token, spreadsheetId, toAppend);
	return { inserted: toAppend.length, updated };
}

async function loadJson(path) {
	const raw = await readFile(path, 'utf8');
	return JSON.parse(raw);
}

async function main() {
	const args = parseArgs(process.argv);
	if (!args.profile || !args.serpApiKey || !args.serviceAccount) {
		console.error(
			'Usage: node lead-generator.mjs --profile profile.json --serpApiKey YOUR_KEY --serviceAccount service-account.json [--spreadsheetId id] [--sheetTitle title]',
		);
		process.exit(1);
	}

	const profile = await loadJson(args.profile);
	const serviceAccount = await loadJson(args.serviceAccount);
	const queries = createQueries(profile);
	const rawLeads = [];

	for (const query of queries) {
		const results = await googleSearch(query, args.serpApiKey);
		for (const result of results) {
			const lead = mapSearchResultToLead(result, profile);
			if (lead) rawLeads.push(lead);
		}
	}

	const leads = deduplicateLeads(rawLeads);
	const token = await getGoogleAccessToken(serviceAccount);
	let spreadsheetId = args.spreadsheetId;

	if (!spreadsheetId) {
		const spreadsheet = await createSpreadsheet(
			token,
			args.sheetTitle || `B2B Leads - ${new Date().toISOString().slice(0, 10)}`,
		);
		spreadsheetId = spreadsheet.spreadsheetId;
	}

	const result = await syncLeadsToSheet(token, spreadsheetId, leads);
	console.log(
		JSON.stringify(
			{
				spreadsheetId,
				queries,
				totalLeadsFound: rawLeads.length,
				uniqueLeads: leads.length,
				inserted: result.inserted,
				updated: result.updated,
			},
			null,
			2,
		),
	);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(error);
		process.exit(1);
	});
}

export {
	createQueries,
	deduplicateLeads,
	extractNameFromTitle,
	isLinkedInProfileUrl,
	mapSearchResultToLead,
	normalizeValue,
};
