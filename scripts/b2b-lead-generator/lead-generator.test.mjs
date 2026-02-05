import test from 'node:test';
import assert from 'node:assert/strict';

import {
	createQueries,
	deduplicateLeads,
	isLinkedInProfileUrl,
	mapSearchResultToLead,
} from './lead-generator.mjs';

test('createQueries builds one query per target role', () => {
	const queries = createQueries({
		targetRoles: ['CEO', 'Director'],
		industry: 'consultoría',
		country: 'México',
		city: 'CDMX',
		keywords: ['estrategia'],
	});

	assert.equal(queries.length, 2);
	assert.match(queries[0], /site:linkedin\.com\/in/);
	assert.match(queries[0], /"CEO"/);
});

test('isLinkedInProfileUrl validates profile urls', () => {
	assert.equal(isLinkedInProfileUrl('https://www.linkedin.com/in/jane-doe/'), true);
	assert.equal(isLinkedInProfileUrl('https://www.linkedin.com/company/acme/'), false);
});

test('mapSearchResultToLead maps valid Google result', () => {
	const lead = mapSearchResultToLead(
		{
			title: 'Jane Doe - CEO - Acme Corp | LinkedIn',
			link: 'https://www.linkedin.com/in/jane-doe/',
			snippet: 'CEO at Acme Corp. Website acme.com',
		},
		{ country: 'España', city: 'Madrid' },
	);

	assert.ok(lead);
	assert.equal(lead.decisionMakerName, 'Jane Doe');
	assert.equal(lead.companyWebsite, 'https://acme.com');
});

test('deduplicateLeads keeps first lead per profile url', () => {
	const unique = deduplicateLeads([
		{ decisionMakerLinkedInUrl: 'https://linkedin.com/in/a', value: 1 },
		{ decisionMakerLinkedInUrl: 'https://linkedin.com/in/a', value: 2 },
	]);

	assert.equal(unique.length, 1);
	assert.equal(unique[0].value, 1);
});
