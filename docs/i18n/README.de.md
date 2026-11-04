![BugGPS · Record the bug. Verify the fix. · 录下问题，按原预期复核修复。](../media/buggps-hero.webp)

[![GitHub release](https://img.shields.io/github/v/release/lijiaqi-AI-Product-Manager/dsh-bug-gps?color=24bfa5)](https://github.com/lijiaqi-AI-Product-Manager/dsh-bug-gps/releases/latest) [![npm version](https://img.shields.io/npm/v/dsh-bug-gps?logo=npm&color=24bfa5)](https://www.npmjs.com/package/dsh-bug-gps) [![CI](https://github.com/lijiaqi-AI-Product-Manager/dsh-bug-gps/actions/workflows/test.yml/badge.svg?event=pull_request)](https://github.com/lijiaqi-AI-Product-Manager/dsh-bug-gps/actions/workflows/test.yml) [![CLI Node 20 or newer](https://img.shields.io/badge/CLI_Node-%E2%89%A520-43853d?logo=node.js)](https://github.com/lijiaqi-AI-Product-Manager/dsh-bug-gps/blob/main/docs/installation.md) [![DSH 0.2.1-rc.5](https://img.shields.io/badge/DSH-0.2.1--rc.5-0d9488)](https://github.com/lijiaqi-AI-Product-Manager/dsh-bug-gps/blob/main/docs/host-compatibility.md) [![MIT license](https://img.shields.io/github/license/lijiaqi-AI-Product-Manager/dsh-bug-gps?color=3b82f6)](https://github.com/lijiaqi-AI-Product-Manager/dsh-bug-gps/blob/main/LICENSE)

[安装 / Install](../installation.md) · [演示 / Demo](../media/buggps-demo.gif) · [运行依据 / Evidence](https://github.com/lijiaqi-AI-Product-Manager/dsh-bug-gps/issues/4)

# BugGPS · dsh-bug-gps

[简体中文](../../README.md) · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md)

![BugGPS 流程示意 / Workflow illustration: Record → Lock → Fix → Replay → Original-code control.](../media/buggps-workflow.webp)

**Fehler aufzeichnen. Die Korrektur am ursprünglichen Sollverhalten prüfen.**

BugGPS ist ein Plugin für DeepSeek Harness (DSH). Es richtet sich an bereits entdeckte Browserfehler: Aktionen und erwartetes Ergebnis erfassen, einen wiederholbaren Fehler festhalten und den geänderten Code mit denselben Prüfungen und einer unabhängigen Ausgangsversion verifizieren.

> Installiere die veröffentlichte Version **1.0.0** von npm. Unterstützt werden DSH **0.2.1-rc.5**, `headless` / `web`, unter Windows. Feste Git- und Release-Quellen stehen in der [Installationsanleitung](../installation.md).

```bash
dsh plugin --profile web add dsh-bug-gps@1.0.0
dsh --profile web --dump-config
```

Das Beispiel nutzt `web`; für eine Headless-Instanz beide Befehle auf `headless` umstellen. Nach Bestätigung der Konfigurationsebene die Instanz neu starten und `buggps_status` im Ziel-Git-Projekt aufrufen. Der Desktop ist gesondert zu prüfen.

[Installation und Entfernen (Chinesisch/Englisch)](../installation.md) · [Historische Prüfungen (festgelegter Quellstand)](../verification/1.0.0/README.md). Jeder Nachweis nennt seinen Quellstand und Geltungsbereich; aktuelle Prüfungen stehen in der Veröffentlichungscheckliste.

Nach einem Update ältere Browseraufzeichnungen neu erstellen. Beim Festschreiben werden erfasster Text, Werte und Sichtbarkeit geprüft. Aktionen in Frames oder anderen Tabs lassen die Aufzeichnung unvollständig.

![BugGPS](../media/buggps-demo.gif)

Die Demo steuert das mitgelieferte Beispiel mit eingebautem Fehler per Skript und wendet vorbereitete Änderungen an. Seiten und Werkzeugausgaben stammen aus echten Durchläufen; ausgewählte Bilder wurden geschnitten. Die Videolänge entspricht keiner gemessenen Laufzeit. Ergebniskarten, Mauszeiger und Untertitel sind Präsentationselemente.

## Das Beispiel ausprobieren

Benötigt Node.js ≥20, Git sowie Microsoft Edge oder Google Chrome. Die dokumentierten Windows-Prüfungen verwenden Node 24.22.0 und Edge 156. Andere Browser und Betriebssysteme sind damit nicht abgedeckt.

```bash
git clone https://github.com/lijiaqi-AI-Product-Manager/dsh-bug-gps.git
cd dsh-bug-gps
git checkout --detach c48aa094b6b32731d517fb0026cceccdae60e117
npm ci
node bin/buggps.js demo ../buggps-demo
node bin/buggps.js doctor --repo ../buggps-demo
```

`demo` erstellt ein separates Git-Repository und zeigt die nächsten Schritte. Den Entwicklungsserver starten, das Projekt in DSH öffnen und Fehler sowie Sollverhalten aufzeichnen. `doctor` prüft Laufzeit, Browser, Befehle, Konfiguration und Port. Vorhandene Entwürfe lassen sich ohne erneute interaktive Aufnahme festschreiben.

## Das Plugin in DSH laden

Für `dsh plugin` muss außerdem **pnpm ≥10** im PATH verfügbar sein.

```bash
dsh plugin --profile PROFILE add "/absolute/path/to/dsh-bug-gps"
dsh --profile PROFILE --dump-config
```

`PROFILE` durch das tatsächlich verwendete Profil und den Pfad durch den absoluten Checkout-Pfad ersetzen. Die betreffende DSH-Instanz neu starten und im Zielprojekt `buggps_status` aufrufen. Ein Konfigurationseintrag allein belegt keine erfolgreiche Werkzeugregistrierung.

Desktop und CLI können unterschiedliche Profile verwenden. Eine Installation in `web` bestätigt keine Desktop-Installation. Vor der Nutzung der Pluginverwaltung die eingebettete DSH-Version und das tatsächliche Profil prüfen. Der offizielle rc.5-CLI-Ablauf wurde ausgeführt; der Desktop-Installationsweg hat noch keine separate Abnahme durchlaufen.

## Ablauf

1. **Aufzeichnen:** Aktionen, Browsereinstellungen und ausdrückliche Erwartungen speichern. Optionale Prüfpunkte halten Zwischenzustände fest; markierte Schlüsselschritte bleiben bei der Kürzung erhalten.
2. **Festschreiben:** Die App mit dem gespeicherten `serve`-Befehl starten und denselben Fehler standardmäßig dreimal reproduzieren.
3. **Korrigieren:** DSH bearbeitet den Anwendungscode mit der vorhandenen Konfiguration.
4. **Prüfen:** Die vollständige Aufnahme standardmäßig dreimal unter den ursprünglichen Bedingungen abspielen. Für `VERIFIED` muss auch eine unabhängige Ausgangsversion den festgehaltenen Fehler erneut zeigen.

## Ergebnisse verstehen

| Ergebnis | Bedeutung |
|---|---|
| `VERIFIED` | Die aufgezeichneten Prüfungen bestehen; eine frische Ausgangsversion reproduziert den Fehler. |
| `PASSED_UNBOUND` | Die Prüfungen bestehen auf einem externen Server, dessen Code nicht an diesen Patch gebunden ist. |
| `NEEDS_REVIEW` | Schwächere Belege erfordern Prüfung: deaktivierter Auslöser, reine Abwesenheitsprüfungen, andere Lokatoren, anderer Prüfer oder fehlgeschlagener Ausgangsvergleich. |
| `STILL_FAILING / DIFFERENT_FAILURE` | Der ursprüngliche Fehler bleibt oder ein anderes Symptom bzw. ein Prüfpunkt schlägt fehl. |
| `TEST_INVALID / ENV_BLOCKED` | Die Testdefinition ist unbrauchbar oder die Umgebung blockiert. Beides ist keine erfolgreiche Reproduktion. |
| `FLAKY / STALE / CASE_TAMPERED` | Unterschiedliche Ergebnisse, Änderungen während der Prüfung oder veränderte festgeschriebene Belege. |
| `NO_CODE_CHANGE` | Unveränderter Ausgangscode. Einen beauftragten Fix fortsetzen; bei reiner Prüfung den unveränderten Stand melden. |
| `BUDGET_EXHAUSTED / ABORTED` | Budget erschöpft oder Aufgabe abgebrochen; die Belege sind unvollständig. |

`buggps_status` zeigt den zuletzt abgeschlossenen gültigen Lauf an. Ein früheres Ergebnis gilt nur weiter, wenn Code, Testfall, festgeschriebene Angaben und Prüfer übereinstimmen. `not_current_reasons` nennt die Abweichungen. `NO_CODE_CHANGE` bedeutet weiterhin unveränderten Code und bestätigt keine Korrektur.

Textvorschauen sind auf 12.000 Zeichen begrenzt; Urteil, Belegverweise und nächste Schritte stehen zuerst. Bei `output_preview: abbreviated` den referenzierten Entwurf, Testfall, Laufbericht oder Patch lesen. Vollständige strukturierte Ergebnisse und Prüfungen bleiben unverändert. Tests oder Patches nicht aus gekürztem Text rekonstruieren.

## Umfang und Grenzen

- Das Ergebnis gilt für das aufgezeichnete Szenario, nicht für die Fehlerfreiheit der gesamten App.
- Unterstützt wird zurücksetzbarer Frontend-Zustand. Ein Aufwärmdurchlauf geht den gezählten Versuchen voraus; Änderungen an Serverdaten sind nicht abgenommen.
- Die Schlussprüfungen laufen standardmäßig 1.000 ms mit einem Zielabstand von 50 ms. Lücken und spätere Änderungen bleiben außerhalb dieser Beobachtung.
- Kürzung liefert einen bestätigten kürzeren Pfad innerhalb eines Budgets. Maßgeblich bleibt die vollständige Aufnahme; globale Minimalität und Kausalität werden nicht zugesichert.
- Snapshots folgen Git und lassen ignorierte Abhängigkeiten und Konfiguration aus. Geteilte Abhängigkeiten und Umgebungsdaten des Ausgangsvergleichs werden separat erfasst. Ein worktree ist keine Sicherheits-Sandbox.
- Als geheim erkannte Eingaben werden als Umgebungsreferenzen gespeichert. Die Erkennung ist unvollständig; Artefakte vor dem Teilen prüfen.
- Definitionen und Belege werden auf Konsistenz geprüft. Shell-Schutz ist begrenzt; Hashwerte sind kein fälschungssicherer Nachweis.

[Konfiguration, alle Ergebnisse und ausführliche Grenzen](../../README.md)

## Belege und Rückmeldungen

Tests, Paketinstallation und der feste Satz aus zwölf historischen Fällen werden getrennt dokumentiert. Die Fälle flossen in Verbesserungen ein und bilden einen erweiterten Regressionstest, keinen blinden Testsatz. Fehlversuche bleiben im Nenner.

[Fallanleitung](../../bench/RECORDING-GUIDE.md) · [Laufprotokolle](../../bench/results) · [Browser-Regressionstests](../../test/counterexamples.test.js) · [Problem melden](https://github.com/lijiaqi-AI-Product-Manager/dsh-bug-gps/issues/new)

DSH-Version, Betriebssystem, Sollverhalten, exaktes Ergebnis und eine sicher teilbare Reproduktion angeben. Zugangsdaten und private Daten entfernen.

Hat BugGPS bei einer Korrektur geholfen, unterstützt ein Star die Auffindbarkeit.

[Host-Abhängigkeiten und Paketkompatibilität](../host-compatibility.md)

MIT · [LICENSE](../../LICENSE)


[Die Korrektur im externen ChartDB-Projekt nachvollziehen](../../bench/repairs/chartdb-dbml-index/README.md) · [DSH rc.5](../../bench/results/account-project-chartdb-dbml-index-2026-11-03.json) · [ChartDB-Beispiel: AGPLv3](../../bench/repairs/chartdb-dbml-index/LICENSE)
