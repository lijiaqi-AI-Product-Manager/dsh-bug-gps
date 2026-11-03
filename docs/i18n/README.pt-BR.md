# BugGPS · dsh-bug-gps

[简体中文](../../README.md) · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md)

**Registre o problema. Verifique a correção com a expectativa original.**

BugGPS é um plugin para DeepSeek Harness (DSH), voltado a problemas de navegador já identificados. Ele registra ações e resultados esperados, estabelece uma falha reproduzível e verifica o código alterado com as mesmas condições e uma versão de referência independente.

> Pré-lançamento. O pacote npm ainda não foi publicado. A instalação usa uma cópia local do código. A compatibilidade atual está limitada ao DSH **0.2.1-rc.5**.

![BugGPS](../media/buggps-demo.gif)

A demonstração usa um script para operar o exemplo incluído, que contém um defeito intencional, e aplica alterações preparadas. As páginas e saídas são reais, mas os quadros foram editados: a duração do vídeo não representa o tempo da tarefa. Cartões de resultado, cursor e legendas são elementos de apresentação.

## Experimentar o exemplo

Requer Node.js ≥20, Git e Microsoft Edge ou Google Chrome instalado. As verificações registradas no Windows usam Node 24.22.0 e Edge 156; isso não comprova suporte a todos os navegadores e sistemas.

```bash
git clone --branch test/release-integration --single-branch https://github.com/lijiaqi-AI-Product-Manager/dsh-bug-gps.git
cd dsh-bug-gps
npm ci
node bin/buggps.js demo ../buggps-demo
node bin/buggps.js doctor --repo ../buggps-demo
```

`demo` cria um repositório Git separado e mostra as próximas etapas. Inicie o servidor de desenvolvimento, abra o projeto no DSH e registre o problema e o resultado esperado. `doctor` verifica o ambiente, navegador, comandos, configuração e porta. Rascunhos existentes podem ser fixados sem outra gravação interativa.

## Carregar o plugin no DSH

Para carregar com `dsh plugin`, também é necessário **pnpm ≥10** no PATH.

```bash
dsh plugin --profile PROFILE add "/absolute/path/to/dsh-bug-gps"
dsh --profile PROFILE --dump-config
```

Substitua `PROFILE` pelo perfil realmente usado e o caminho pela localização absoluta do código. Reinicie essa instância do DSH e chame `buggps_status` no projeto. Uma entrada de configuração não prova que as ferramentas foram carregadas.

O aplicativo desktop e a CLI podem usar perfis diferentes. Instalar em `web` não confirma a instalação no desktop. Confira a versão DSH incluída e o perfil real antes de usar o gerenciador de plugins. O fluxo da CLI oficial rc.5 foi executado; a instalação no desktop ainda não concluiu sua aceitação independente.

## Como funciona

1. **Registrar:** salvar ações, configurações do navegador e expectativas explícitas. Pontos de controle preservam estados intermediários; etapas essenciais permanecem ao encurtar.
2. **Fixar:** iniciar o aplicativo com o comando `serve` salvo e reproduzir a mesma falha três vezes por padrão.
3. **Corrigir:** o DSH altera o código do aplicativo usando sua configuração existente.
4. **Verificar:** reproduzir a gravação completa três vezes por padrão, nas condições originais. Uma versão de referência independente também precisa reproduzir a falha original para obter `VERIFIED`.

## Entender o resultado

| Resultado | Significado |
|---|---|
| `VERIFIED` | As verificações passam e uma nova execução da referência reproduz a falha original. |
| `PASSED_UNBOUND` | As verificações passam em um servidor externo cujo código não pode ser associado ao patch. |
| `NEEDS_REVIEW` | Exige análise: gatilho desativado, apenas condições de ausência, mudança de localizador ou avaliador, ou referência não reproduzida. |
| `STILL_FAILING / DIFFERENT_FAILURE` | A falha original persiste ou outro sintoma ou ponto de controle falha. |
| `TEST_INVALID / ENV_BLOCKED` | Definição de teste inválida ou ambiente bloqueado; não é uma reprodução bem-sucedida. |
| `FLAKY / STALE / CASE_TAMPERED` | Resultados inconsistentes, código alterado durante a verificação ou evidências fixadas modificadas. |
| `NO_CODE_CHANGE` | Código sem alterações desde a fixação. Continuar a correção solicitada; se o pedido for apenas verificar, informar que não houve mudanças. |
| `BUDGET_EXHAUSTED / ABORTED` | Orçamento esgotado ou tarefa cancelada; as evidências estão incompletas. |

## Escopo e limitações

- O resultado cobre o cenário registrado; não comprova a ausência de outros defeitos.
- O estado do frontend precisa ser reinicializável. Uma reprodução de aquecimento precede as tentativas contadas; operações que alteram dados do servidor estão fora do escopo aceito.
- As condições finais são amostradas por 1.000 ms, por padrão, com intervalo alvo de 50 ms. Lacunas e mudanças posteriores não são cobertas.
- O encurtamento retorna um caminho menor confirmado dentro de um orçamento. A gravação completa continua sendo a referência; não há garantia de mínimo global nem de causalidade.
- Os snapshots seguem o Git e excluem dependências e configurações ignoradas. Dependências compartilhadas e entradas de ambiente do controle de referência são registradas separadamente. Um worktree não é um sandbox de segurança.
- Entradas reconhecidas como sensíveis são salvas como referências de ambiente. A detecção é imperfeita; revise os artefatos antes de compartilhar.
- A consistência de definições e registros é verificada. A proteção do shell é limitada; hashes não são uma prova impossível de falsificar.

[Configuração, resultados completos e limitações detalhadas](../../README.md)

## Evidências e feedback

Os testes, a instalação do pacote e os doze casos históricos fixos têm registros separados. Os casos contribuíram para melhorias e formam uma regressão ampliada, não uma avaliação às cegas. As falhas permanecem no denominador.

[Guia dos casos](../../bench/RECORDING-GUIDE.md) · [Registros de execução](../../bench/results) · [Regressões no navegador](../../test/counterexamples.test.js) · [Relatar um problema](https://github.com/lijiaqi-AI-Product-Manager/dsh-bug-gps/issues/new)

Inclua versão DSH, sistema operacional, comportamento esperado, veredicto exato e uma reprodução segura. Remova credenciais e dados privados.

Se BugGPS ajudou a verificar uma correção, uma Star ajuda outras pessoas a encontrá-lo.

[Dependências do ambiente e verificação do pacote](../host-compatibility.md)

MIT · [LICENSE](../../LICENSE)


[Reproduzir a verificação da correção do ChartDB](../../bench/repairs/chartdb-dbml-index/README.md) · [DSH rc.5](../../bench/results/account-project-chartdb-dbml-index-2026-11-03.json) · [Caso ChartDB: AGPLv3](../../bench/repairs/chartdb-dbml-index/LICENSE)
