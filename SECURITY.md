# Security Policy

Grazie per aiutare a mantenere `avoid.quest` sicuro.

## Segnalazione di vulnerabilità

Per favore **non aprire issue pubbliche** per segnalazioni di sicurezza.

Usa uno dei seguenti canali privati:

1. Email: **security@avoid.quest**
2. GitHub: **Private Vulnerability Reporting / Security Advisory** di questo repository

Quando segnali una vulnerabilità, includi:
- descrizione del problema e impatto atteso;
- passi per riprodurre;
- ambiente/versione/branch coinvolti;
- eventuale proof-of-concept;
- suggerimenti di mitigazione (se disponibili).

## Triage e tempi di risposta

Obiettivi di servizio (best effort):

- **Conferma ricezione**: entro **2 giorni lavorativi**
- **Valutazione iniziale (triage)**: entro **5 giorni lavorativi**
- **Aggiornamento sul piano di fix/remediation**: entro **10 giorni lavorativi** dal triage

Le tempistiche possono variare in base alla severità, complessità tecnica e disponibilità dei maintainer.

## Versioni e branch supportati

| Versione / Branch | Supporto sicurezza |
| --- | --- |
| `main` | ✅ Supportata |
| branch di release correnti (se presenti) | ✅ Supportate fino a fine ciclo |
| branch legacy/archiviati | ❌ Non supportate |

Le patch di sicurezza vengono applicate prima su `main` e, quando appropriato, retroportate ai branch di release supportati.

## Cosa non pubblicare in issue pubbliche

Non pubblicare in issue, discussion o PR pubbliche:

- dettagli tecnici exploitabili prima del fix;
- proof-of-concept funzionanti;
- chiavi API, token, segreti, credenziali;
- URL interni, configurazioni sensibili, dump di database/log contenenti dati personali.

Attendi la risoluzione/coordinamento con i maintainer prima di divulgare pubblicamente i dettagli.
