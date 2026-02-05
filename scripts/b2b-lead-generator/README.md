# B2B Lead Generator (LinkedIn + Google Sheets)

Aplicación CLI para generar leads B2B de forma automatizada a partir de búsquedas en Google y guardar resultados en Google Sheets.

## Qué resuelve

- Define un perfil objetivo (cargo, industria, ubicación, keywords).
- Ejecuta búsquedas de Google con operadores avanzados para encontrar perfiles públicos de LinkedIn.
- Extrae datos clave del lead.
- Crea una hoja en Google Sheets (si no existe) y sincroniza leads sin duplicados.
- Actualiza filas existentes cuando detecta cambios.

## Campos almacenados en Google Sheets

1. Business Name
2. CEO/Director Name
3. CEO/Director LinkedIn Profile URL
4. Company Website
5. Company LinkedIn Profile URL
6. Country
7. City

## Requisitos

- Node.js 22+
- API key de [SerpAPI](https://serpapi.com/) para búsquedas en Google.
- Cuenta de servicio de Google con acceso a Google Sheets API y Drive API.

## Configuración

1. Copia `profile.example.json` a `profile.json` y ajusta tus filtros.
2. Descarga el JSON de credenciales de una service account de Google.
3. (Opcional) Si quieres usar una hoja existente, obtén `spreadsheetId`.

## Uso

```bash
node scripts/b2b-lead-generator/lead-generator.mjs \
  --profile scripts/b2b-lead-generator/profile.json \
  --serpApiKey <SERP_API_KEY> \
  --serviceAccount /ruta/service-account.json
```

Opciones adicionales:

- `--spreadsheetId <id>`: usa una hoja existente en vez de crear una nueva.
- `--sheetTitle "B2B Leads Q1"`: título para la hoja nueva.

## Ejemplo de salida

```json
{
  "spreadsheetId": "1abc...xyz",
  "queries": [
    "site:linkedin.com/in \"CEO\" consultoría estratégica España Madrid transformación digital estrategia crecimiento B2B"
  ],
  "totalLeadsFound": 18,
  "uniqueLeads": 11,
  "inserted": 8,
  "updated": 3
}
```

## Notas de diseño

- La deduplicación usa la URL del perfil LinkedIn del decisor como llave única.
- Si la fila ya existe y cambian valores, se actualiza en sitio.
- `Company LinkedIn Profile URL` queda vacío en esta versión base si no se puede inferir con fiabilidad desde el snippet.
