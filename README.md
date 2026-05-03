# Vigna Check-in Dashboard

Dashboard statica per gestire gli ingressi degli eventi in vigna.

## Come provarla in VS Code

1. Apri questa cartella in VS Code.
2. Apri il terminale integrato.
3. Esegui:

```bash
node server.js
```

4. Apri nel browser:

`http://localhost:5173`

Usa questo server locale invece di Live Server: oltre a servire la pagina, fa da proxy verso DWS e riduce i problemi di CORS/403 dal browser.

## Flusso

1. Apri **Configurazione**.
2. Inserisci la API Key generata da Divinea.
3. Controlla `Winery ID` e `Base URL CRM API`.
4. Usa `https://api-crm.divinea.com/api` per produzione oppure `https://api-crm-staging.divinea.com/api` per staging.
5. Seleziona la data e clicca **Cerca esperienze**.
6. Clicca sul titolo evento trovato.
7. Se hai inserito il Bearer token DWS, la dashboard importa le prenotazioni `confirmed` da `scheduling/page`.
8. Cliccando **OK** la riga passa in **Arrivati** e lo stato diventa `Arrivati`.

## Nota API

La ricerca titoli evento usa l'endpoint pubblico:

`GET https://api.divinea.com/api/v2/experiences`

Parametri:

```text
page=1
per_page=9999
company_ids=d37461d4-bf09-4f45-9e36-35d49baf84a8
lang=it
startdate=2026-05-01T00:00:00.000Z
enddate=2026-05-01T24:00:00.000Z
includeArchived=true
includeInactive=true
```

La dashboard mostra solo esperienze con tag `category.code = "exptype"` e `name = "Evento"`.

Le prenotazioni vengono lette tramite proxy locale da:

`GET https://api-dws.divinea.com/api/scheduling/page?...&experienceId=...&state=confirmed&state=draft&state=waiting&state=completed&lang=it`

Header:

`Authorization: Bearer ...`
