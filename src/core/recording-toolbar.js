import { hasPositiveCheck } from './oracle.js';

const messages = {
  'zh-CN': {
    recording: '录制中', picking: '请选择页面元素 · Esc 取消', stopped: '录制已结束', steps: '已记录 {n} 步',
    expectations: '已设置 {n} 项预期', expectationOne: '已设置 1 项预期', checkpoints: '{n} 个检查点', pins: '{n} 个关键步骤', noExpectation: '尚未设置预期',
    text: '预期文本', value: '预期输入值', visible: '应可见', hidden: '应消失', noError: '不应报错', checkpoint: '此刻应为', pin: '上一步是关键',
    finish: '结束录制', more: '更多检查', language: '界面语言', collapse: '收起工具栏', expand: '展开工具栏', move: '移动到其他角落', cancel: '取消选取',
    help: '操作页面重现问题，再标出正确结果。', pickHelp: '点击要检查的页面元素；这次点击不会执行页面操作。', checkpointHelp: '检查点固定此刻状态，修复前后都必须保持。',
    missing: '尚未设置正向预期，当前记录不能确认修复。', issues: '{n} 项输入问题，当前记录不可用于验证。', continue: '继续录制', incomplete: '保留未完成记录并结束',
    'expectation-set': '预期已记录', 'checkpoint-set': '检查点已记录', 'key-set': '关键步骤已标记', 'selection-cancelled': '已取消选取',
    'no-error-set': '已添加不应报错；还需标出应出现的正确结果。', 'secret-refused': '敏感字段不能作为预期。', 'unsupported-input': '此输入无法保真回放，请查看输入问题。', disconnected: '记录连接中断，请检查宿主任务状态。',
    expectedPrompt: '当前内容：{value}\n正确应该是什么？', checkpointPrompt: '此刻应该是什么？', summary: '当前验收条件', remaining: '另有 {n} 项预期',
  },
  en: {
    recording: 'Recording', picking: 'Choose a page element · Esc to cancel', stopped: 'Recording finished', steps: '{n} steps recorded',
    expectations: '{n} expectations set', expectationOne: '1 expectation set', checkpoints: '{n} checkpoints', pins: '{n} pinned steps', noExpectation: 'No expectation set',
    text: 'Expected text', value: 'Expected input value', visible: 'Should be visible', hidden: 'Should disappear', noError: 'No page error', checkpoint: 'Checkpoint', pin: 'Keep previous step',
    finish: 'Finish recording', more: 'More checks', language: 'Interface language', collapse: 'Collapse toolbar', expand: 'Expand toolbar', move: 'Move to another corner', cancel: 'Cancel selection',
    help: 'Reproduce the problem, then mark the correct result.', pickHelp: 'Choose the element to check. This click will not operate the page.', checkpointHelp: 'A checkpoint preserves this state before and after a fix.',
    missing: 'No positive expectation is set. This recording cannot confirm a fix.', issues: '{n} input issues; this recording cannot be used for verification.', continue: 'Continue recording', incomplete: 'Keep incomplete recording and finish',
    'expectation-set': 'Expectation recorded', 'checkpoint-set': 'Checkpoint recorded', 'key-set': 'Previous step pinned', 'selection-cancelled': 'Selection cancelled',
    'no-error-set': 'No-error check added. Also mark a correct result that should appear.', 'secret-refused': 'A sensitive field cannot be an expectation.', 'unsupported-input': 'This input cannot be replayed faithfully. Review the input issues.', disconnected: 'Recording connection lost. Check the host task.',
    expectedPrompt: 'Current content: {value}\nWhat should it be?', checkpointPrompt: 'What should be shown at this point?', summary: 'Current acceptance checks', remaining: '{n} more expectations',
  },
  ja: {
    recording: '記録中', picking: 'ページの要素を選択 · Esc で取消', stopped: '記録が終了しました', steps: '{n} ステップを記録',
    expectations: '期待する結果を {n} 件設定', expectationOne: '期待する結果を 1 件設定', checkpoints: 'チェックポイント {n} 件', pins: '固定ステップ {n} 件', noExpectation: '期待する結果が未設定です',
    text: '期待するテキスト', value: '期待する入力値', visible: '表示されること', hidden: '消えること', noError: 'ページエラーなし', checkpoint: 'チェックポイント', pin: '直前の操作を保持',
    finish: '記録を終了', more: 'その他のチェック', language: '表示言語', collapse: 'ツールバーを折りたたむ', expand: 'ツールバーを開く', move: '別の隅へ移動', cancel: '選択を取り消す',
    help: '問題を再現し、正しい結果を指定してください。', pickHelp: '確認する要素を選択します。このクリックはページを操作しません。', checkpointHelp: '修正の前後でこの時点の状態を維持します。',
    missing: '正しい結果が未設定のため、修正を確認できません。', issues: '入力の問題 {n} 件。この記録は検証に使用できません。', continue: '記録を続ける', incomplete: '未完了の記録を残して終了',
    'expectation-set': '期待する結果を記録しました', 'checkpoint-set': 'チェックポイントを記録しました', 'key-set': '直前の操作を固定しました', 'selection-cancelled': '選択を取り消しました',
    'no-error-set': 'エラーなしを追加しました。表示されるべき正しい結果も指定してください。', 'secret-refused': '機密項目は期待する結果に指定できません。', 'unsupported-input': 'この入力を正確に再生できません。入力の問題を確認してください。', disconnected: '記録の接続が切れました。ホストのタスクを確認してください。',
    expectedPrompt: '現在の内容：{value}\n正しい内容は何ですか？', checkpointPrompt: 'この時点で表示されるべき内容は？', summary: '現在の確認条件', remaining: 'その他 {n} 件の期待する結果',
  },
  ko: {
    recording: '기록 중', picking: '페이지 요소 선택 · Esc로 취소', stopped: '기록 완료', steps: '{n}단계 기록됨',
    expectations: '기대 결과 {n}개 설정됨', expectationOne: '기대 결과 1개 설정됨', checkpoints: '체크포인트 {n}개', pins: '고정 단계 {n}개', noExpectation: '기대 결과가 없습니다',
    text: '기대 텍스트', value: '기대 입력값', visible: '표시되어야 함', hidden: '사라져야 함', noError: '페이지 오류 없음', checkpoint: '체크포인트', pin: '이전 단계 유지',
    finish: '기록 종료', more: '추가 검사', language: '인터페이스 언어', collapse: '도구 모음 접기', expand: '도구 모음 펼치기', move: '다른 모서리로 이동', cancel: '선택 취소',
    help: '문제를 재현한 뒤 올바른 결과를 지정하세요.', pickHelp: '검사할 요소를 선택하세요. 이 클릭은 페이지를 조작하지 않습니다.', checkpointHelp: '수정 전후에 이 시점의 상태를 유지합니다.',
    missing: '올바른 결과를 지정하지 않아 수정 여부를 확인할 수 없습니다.', issues: '입력 문제 {n}개. 이 기록은 검증에 사용할 수 없습니다.', continue: '계속 기록', incomplete: '미완료 기록을 남기고 종료',
    'expectation-set': '기대 결과 기록됨', 'checkpoint-set': '체크포인트 기록됨', 'key-set': '이전 단계 고정됨', 'selection-cancelled': '선택 취소됨',
    'no-error-set': '오류 없음 검사를 추가했습니다. 표시되어야 할 올바른 결과도 지정하세요.', 'secret-refused': '민감한 필드는 기대 결과로 지정할 수 없습니다.', 'unsupported-input': '이 입력을 정확하게 재생할 수 없습니다. 입력 문제를 확인하세요.', disconnected: '기록 연결이 끊겼습니다. 호스트 작업을 확인하세요.',
    expectedPrompt: '현재 내용: {value}\n올바른 내용은 무엇인가요?', checkpointPrompt: '이 시점에 무엇이 표시되어야 하나요?', summary: '현재 확인 조건', remaining: '기대 결과 {n}개 더 있음',
  },
  de: {
    recording: 'Aufzeichnung läuft', picking: 'Seitenelement wählen · Esc bricht ab', stopped: 'Aufzeichnung beendet', steps: '{n} Schritte aufgezeichnet',
    expectations: '{n} Erwartungen festgelegt', expectationOne: '1 Erwartung festgelegt', checkpoints: '{n} Prüfpunkte', pins: '{n} feste Schritte', noExpectation: 'Keine Erwartung festgelegt',
    text: 'Erwarteter Text', value: 'Erwarteter Eingabewert', visible: 'Soll sichtbar sein', hidden: 'Soll verschwinden', noError: 'Kein Seitenfehler', checkpoint: 'Prüfpunkt', pin: 'Letzten Schritt behalten',
    finish: 'Aufzeichnung beenden', more: 'Weitere Prüfungen', language: 'Oberflächensprache', collapse: 'Werkzeugleiste einklappen', expand: 'Werkzeugleiste ausklappen', move: 'In eine andere Ecke verschieben', cancel: 'Auswahl abbrechen',
    help: 'Problem reproduzieren, dann das richtige Ergebnis markieren.', pickHelp: 'Zu prüfendes Element wählen. Dieser Klick bedient die Seite nicht.', checkpointHelp: 'Ein Prüfpunkt erhält diesen Zustand vor und nach der Korrektur.',
    missing: 'Ein positives Ergebnis fehlt. Diese Aufzeichnung kann keine Korrektur bestätigen.', issues: '{n} Eingabeprobleme; diese Aufzeichnung ist nicht zur Prüfung geeignet.', continue: 'Weiter aufzeichnen', incomplete: 'Unvollständige Aufzeichnung behalten und beenden',
    'expectation-set': 'Erwartung aufgezeichnet', 'checkpoint-set': 'Prüfpunkt aufgezeichnet', 'key-set': 'Letzter Schritt fixiert', 'selection-cancelled': 'Auswahl abgebrochen',
    'no-error-set': 'Fehlerfreiheit hinzugefügt. Auch ein richtiges Ergebnis markieren.', 'secret-refused': 'Ein sensibles Feld kann keine Erwartung sein.', 'unsupported-input': 'Diese Eingabe lässt sich nicht unverändert abspielen. Eingabeprobleme prüfen.', disconnected: 'Verbindung zur Aufzeichnung verloren. Host-Aufgabe prüfen.',
    expectedPrompt: 'Aktueller Inhalt: {value}\nWie sollte er lauten?', checkpointPrompt: 'Was sollte an dieser Stelle angezeigt werden?', summary: 'Aktuelle Abnahmeprüfungen', remaining: '{n} weitere Erwartungen',
  },
  fr: {
    recording: 'Enregistrement en cours', picking: 'Choisir un élément · Échap pour annuler', stopped: 'Enregistrement terminé', steps: '{n} étapes enregistrées',
    expectations: '{n} résultats attendus définis', expectationOne: '1 résultat attendu défini', checkpoints: '{n} points de contrôle', pins: '{n} étapes conservées', noExpectation: 'Aucun résultat attendu défini',
    text: 'Texte attendu', value: 'Valeur de saisie attendue', visible: 'Doit être visible', hidden: 'Doit disparaître', noError: 'Aucune erreur de page', checkpoint: 'Point de contrôle', pin: 'Conserver la dernière étape',
    finish: 'Terminer l’enregistrement', more: 'Autres contrôles', language: 'Langue de l’interface', collapse: 'Réduire la barre d’outils', expand: 'Développer la barre d’outils', move: 'Déplacer vers un autre coin', cancel: 'Annuler la sélection',
    help: 'Reproduisez le problème, puis indiquez le résultat correct.', pickHelp: 'Choisissez l’élément à vérifier. Ce clic n’active pas la page.', checkpointHelp: 'Ce point conserve l’état actuel avant et après la correction.',
    missing: 'Aucun résultat positif n’est défini. Cet enregistrement ne peut pas confirmer une correction.', issues: '{n} problèmes de saisie ; cet enregistrement ne peut pas servir à la vérification.', continue: 'Continuer l’enregistrement', incomplete: 'Conserver l’enregistrement incomplet et terminer',
    'expectation-set': 'Résultat attendu enregistré', 'checkpoint-set': 'Point de contrôle enregistré', 'key-set': 'Dernière étape conservée', 'selection-cancelled': 'Sélection annulée',
    'no-error-set': 'Absence d’erreur ajoutée. Indiquez aussi un résultat correct à afficher.', 'secret-refused': 'Un champ sensible ne peut pas définir un résultat attendu.', 'unsupported-input': 'Cette saisie ne peut pas être rejouée fidèlement. Consultez les problèmes de saisie.', disconnected: 'Connexion à l’enregistrement perdue. Vérifiez la tâche dans l’hôte.',
    expectedPrompt: 'Contenu actuel : {value}\nQuel devrait être le contenu ?', checkpointPrompt: 'Que doit-on voir à cette étape ?', summary: 'Contrôles d’acceptation actuels', remaining: '{n} autres résultats attendus',
  },
  es: {
    recording: 'Grabando', picking: 'Elige un elemento · Esc para cancelar', stopped: 'Grabación finalizada', steps: '{n} pasos grabados',
    expectations: '{n} resultados esperados definidos', expectationOne: '1 resultado esperado definido', checkpoints: '{n} puntos de control', pins: '{n} pasos fijados', noExpectation: 'Sin resultado esperado',
    text: 'Texto esperado', value: 'Valor de entrada esperado', visible: 'Debe ser visible', hidden: 'Debe desaparecer', noError: 'Sin errores de página', checkpoint: 'Punto de control', pin: 'Conservar el paso anterior',
    finish: 'Finalizar grabación', more: 'Más comprobaciones', language: 'Idioma de la interfaz', collapse: 'Contraer la barra', expand: 'Expandir la barra', move: 'Mover a otra esquina', cancel: 'Cancelar selección',
    help: 'Reproduce el problema y marca el resultado correcto.', pickHelp: 'Elige el elemento que se comprobará. Este clic no activa la página.', checkpointHelp: 'Este punto conserva el estado actual antes y después de corregir.',
    missing: 'Falta un resultado positivo. Esta grabación no puede confirmar una corrección.', issues: '{n} problemas de entrada; esta grabación no sirve para verificar.', continue: 'Continuar grabando', incomplete: 'Conservar la grabación incompleta y finalizar',
    'expectation-set': 'Resultado esperado grabado', 'checkpoint-set': 'Punto de control grabado', 'key-set': 'Paso anterior fijado', 'selection-cancelled': 'Selección cancelada',
    'no-error-set': 'Se añadió la ausencia de errores. Marca también un resultado correcto.', 'secret-refused': 'Un campo sensible no puede ser un resultado esperado.', 'unsupported-input': 'Esta entrada no se puede reproducir fielmente. Revisa los problemas de entrada.', disconnected: 'Se perdió la conexión de grabación. Revisa la tarea del entorno.',
    expectedPrompt: 'Contenido actual: {value}\n¿Cuál debería ser?', checkpointPrompt: '¿Qué debería mostrarse en este paso?', summary: 'Comprobaciones de aceptación', remaining: '{n} resultados esperados más',
  },
  'pt-BR': {
    recording: 'Gravando', picking: 'Escolha um elemento · Esc para cancelar', stopped: 'Gravação concluída', steps: '{n} etapas gravadas',
    expectations: '{n} resultados esperados definidos', expectationOne: '1 resultado esperado definido', checkpoints: '{n} pontos de controle', pins: '{n} etapas fixadas', noExpectation: 'Nenhum resultado esperado definido',
    text: 'Texto esperado', value: 'Valor de entrada esperado', visible: 'Deve estar visível', hidden: 'Deve desaparecer', noError: 'Sem erro na página', checkpoint: 'Ponto de controle', pin: 'Manter a etapa anterior',
    finish: 'Finalizar gravação', more: 'Mais verificações', language: 'Idioma da interface', collapse: 'Recolher a barra', expand: 'Expandir a barra', move: 'Mover para outro canto', cancel: 'Cancelar seleção',
    help: 'Reproduza o problema e marque o resultado correto.', pickHelp: 'Escolha o elemento a verificar. Este clique não aciona a página.', checkpointHelp: 'Este ponto mantém o estado atual antes e depois da correção.',
    missing: 'Falta um resultado positivo. Esta gravação não pode confirmar uma correção.', issues: '{n} problemas de entrada; esta gravação não pode ser usada na verificação.', continue: 'Continuar gravando', incomplete: 'Manter a gravação incompleta e finalizar',
    'expectation-set': 'Resultado esperado gravado', 'checkpoint-set': 'Ponto de controle gravado', 'key-set': 'Etapa anterior fixada', 'selection-cancelled': 'Seleção cancelada',
    'no-error-set': 'Ausência de erro adicionada. Marque também um resultado correto.', 'secret-refused': 'Um campo sensível não pode ser um resultado esperado.', 'unsupported-input': 'Esta entrada não pode ser reproduzida fielmente. Confira os problemas de entrada.', disconnected: 'A conexão da gravação foi perdida. Confira a tarefa no ambiente.',
    expectedPrompt: 'Conteúdo atual: {value}\nQual deveria ser?', checkpointPrompt: 'O que deve ser exibido nesta etapa?', summary: 'Verificações de aceitação', remaining: 'Mais {n} resultados esperados',
  },
};
const acknowledgementMessages = {
  'zh-CN': ['正在确认记录…', '尚未确认全部记录，请检查宿主任务后重试结束。'],
  en: ['Confirming recording…', 'Some recording events are unconfirmed. Check the host task, then try finishing again.'],
  ja: ['記録を確認中…', '未確認の記録があります。ホストのタスクを確認し、もう一度終了してください。'],
  ko: ['기록 확인 중…', '확인되지 않은 기록이 있습니다. 호스트 작업을 확인한 뒤 다시 종료하세요.'],
  de: ['Aufzeichnung wird bestätigt…', 'Einige Ereignisse sind unbestätigt. Host-Aufgabe prüfen und das Beenden erneut versuchen.'],
  fr: ['Confirmation de l’enregistrement…', 'Certains événements ne sont pas confirmés. Vérifiez la tâche dans l’hôte, puis réessayez de terminer.'],
  es: ['Confirmando la grabación…', 'Hay eventos sin confirmar. Revisa la tarea del entorno e intenta finalizar de nuevo.'],
  'pt-BR': ['Confirmando a gravação…', 'Há eventos não confirmados. Confira a tarefa no ambiente e tente finalizar novamente.'],
};
for (const [language, [syncing, syncFailed]] of Object.entries(acknowledgementMessages)) Object.assign(messages[language], { syncing, syncFailed });
export const TOOLBAR_LANGUAGES = Object.freeze(Object.keys(messages));

export function recordingToolbarState(steps, result, preferences, revision, stopped = false) {
  const checks = [result.expectation, ...result.also].filter(Boolean);
  return {
    revision, stopped, ...preferences, stepCount: steps.length,
    expectationCount: checks.length, positive: hasPositiveCheck(result),
    checkpointCount: steps.filter((step) => step.check).length, pinCount: steps.filter((step) => step.pinned).length,
    issueCount: result.captureIssues.length,
    checks: checks.slice(0, 5).map((check) => ({ kind: check.kind, ...(check.equals !== undefined ? { equals: String(check.equals).slice(0, 120) } : {}) })),
  };
}

function installToolbar(i18n) {
  if (window !== window.top) return;
  const mount = () => {
    if (document.getElementById('__buggps_toolbar') || !document.body) return;
    const host = document.createElement('div');
    host.id = '__buggps_toolbar';
    host.style.cssText = 'all:initial;position:fixed;right:12px;bottom:12px;z-index:2147483647;width:min(360px,calc(100vw - 24px));display:block;color-scheme:dark';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      *{box-sizing:border-box}section{font:14px/1.45 system-ui,-apple-system,sans-serif;color:#f1f5f9;background:#151b26;border:1px solid #64748b;border-radius:12px;box-shadow:0 5px 24px #0005;padding:12px;width:100%;max-height:calc(100dvh - 24px);overflow:auto}
      header{display:flex;gap:8px;align-items:center}.brand{flex:1;min-width:0}strong{font-size:15px}#status{display:block;font-size:12px;color:#cbd5e1;overflow-wrap:anywhere}button,select,summary{font:inherit;min-height:44px;border-radius:7px}button,select{color:inherit;background:#243044;border:1px solid #64748b;padding:8px;cursor:pointer}button{min-width:44px;overflow-wrap:anywhere}button:hover,summary:hover{background:#34445d}button:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #a5b4fc;outline-offset:2px}button[aria-pressed=true]{background:#1847a0;border-color:#93c5fd}button:disabled,select:disabled{opacity:.55;cursor:default}select{max-width:110px;width:110px}#collapse,#finish-mini,#cancel-mini{flex:0 0 44px;width:44px}p{margin:8px 0}.hint,.counts{font-size:12px;color:#cbd5e1}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:8px 0}summary{padding:10px 4px;cursor:pointer}ul{margin:6px 0;padding-left:20px}li{overflow-wrap:anywhere}#checks{font-size:13px}.notice{color:#bfdbfe}#issues,#warning{border:1px solid #e6ae48;border-radius:7px;background:#382b14;color:#ffe3a1;padding:8px;font-size:13px}#warning .grid{grid-template-columns:1fr}footer{display:flex;gap:8px;margin-top:8px}footer button{flex:1}#finish,#finish-mini,#incomplete{background:#762d35;border-color:#e2999f}#finish:hover,#finish-mini:hover,#incomplete:hover{background:#903945}[hidden]{display:none!important}#cancel{background:#243044}#no-error-set{color:#ffe3a1}
    </style>
    <section aria-label="BugGPS"><header><div class="brand"><strong>BugGPS</strong><span id="status" role="status" aria-live="polite" aria-atomic="true"></span></div><select id="language"><option value="zh-CN">简体中文</option><option value="en">English</option><option value="ja">日本語</option><option value="ko">한국어</option><option value="de">Deutsch</option><option value="fr">Français</option><option value="es">Español</option><option value="pt-BR">Português (BR)</option></select><button id="cancel-mini" hidden>×</button><button id="finish-mini" hidden>■</button><button id="collapse" aria-controls="body" aria-expanded="true">⌄</button></header>
      <div id="body"><p id="help" class="hint"></p><div class="grid"><button data-k="text"></button><button data-k="visible"></button></div>
      <details><summary id="more"></summary><div class="grid"><button data-k="value"></button><button data-k="hidden"></button><button data-k="no-page-error"></button><button data-k="checkpoint"></button><button id="pin"></button><button id="move"></button></div></details>
      <div id="checks"><strong id="summary"></strong><p id="expectations"></p><ul id="check-list"></ul><p id="remaining" class="hint" hidden></p><p id="counts" class="counts"></p></div>
      <p id="notice" class="notice" hidden></p><p id="issues" role="alert" hidden></p>
      <div id="warning" role="alert" hidden><p id="missing"></p><div class="grid"><button id="continue"></button><button id="incomplete"></button></div></div>
      <footer><button id="cancel" hidden></button><button id="finish"></button></footer></div>
    </section>`;
    document.documentElement.appendChild(host);
    const el = (id) => root.getElementById(id);
    let state = { revision: -1, language: 'zh-CN', collapsed: false, corner: 'br', stepCount: 1, expectationCount: 0, checkpointCount: 0, pinCount: 0, issueCount: 0, positive: false, checks: [], stopped: false };
    let notice = null;
    let warning = false;
    let finishing = false;
    let pickerCollapsed = false;
    const kindKey = (kind) => ({ 'no-page-error': 'noError' }[kind] ?? kind);
    const tr = (key, args = {}) => {
      const value = (i18n[state.language] ?? i18n.en)[key] ?? i18n.en[key] ?? key;
      return value.replace(/\{(\w+)\}/g, (_, name) => String(args[name] ?? ''));
    };
    const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };
    const label = (node, key) => { const value = tr(key); text(node, value); node.title = value; };
    const render = () => {
      const picking = Boolean(window.__buggpsPickKind);
      const status = state.stopped ? tr('stopped') : finishing ? tr('syncing') : picking ? tr('picking') : state.issueCount ? tr('issues', { n: state.issueCount }) : notice ? tr(notice) : tr('recording');
      text(el('status'), status + ' · ' + tr('steps', { n: state.stepCount }));
      root.querySelector('section').lang = state.language;
      el('language').value = state.language;
      el('language').setAttribute('aria-label', tr('language'));
      el('language').hidden = state.collapsed;
      el('body').hidden = state.collapsed;
      el('collapse').setAttribute('aria-label', tr(state.collapsed ? 'expand' : 'collapse'));
      el('collapse').title = tr(state.collapsed ? 'expand' : 'collapse');
      el('collapse').setAttribute('aria-expanded', String(!state.collapsed));
      text(el('collapse'), state.collapsed ? '⌃' : '⌄');
      for (const id of ['finish-mini', 'cancel-mini']) {
        const cancel = id === 'cancel-mini';
        el(id).hidden = !state.collapsed || cancel && !picking;
        el(id).setAttribute('aria-label', tr(cancel ? 'cancel' : 'finish'));
        el(id).title = tr(cancel ? 'cancel' : 'finish');
      }
      text(el('help'), tr(picking ? window.__buggpsPickKind === 'checkpoint' ? 'checkpointHelp' : 'pickHelp' : 'help'));
      for (const button of root.querySelectorAll('button[data-k]')) {
        label(button, kindKey(button.dataset.k));
        button.setAttribute('aria-pressed', String(window.__buggpsPickKind === button.dataset.k));
      }
      for (const id of ['more', 'summary', 'pin', 'move', 'finish', 'continue', 'incomplete', 'cancel']) label(el(id), id === 'pin' ? 'pin' : id);
      el('pin').disabled = state.stopped || state.stepCount <= 1;
      el('cancel').hidden = !picking;
      text(el('expectations'), state.expectationCount ? tr(state.expectationCount === 1 ? 'expectationOne' : 'expectations', { n: state.expectationCount }) : tr('noExpectation'));
      const entries = state.checks.map((check) => tr(kindKey(check.kind)) + (check.equals === undefined ? '' : ': ' + check.equals));
      if (el('check-list').dataset.value !== JSON.stringify(entries)) {
        el('check-list').replaceChildren(...entries.map((entry) => { const item = document.createElement('li'); item.textContent = entry; return item; }));
        el('check-list').dataset.value = JSON.stringify(entries);
      }
      el('remaining').hidden = state.expectationCount <= entries.length;
      text(el('remaining'), tr('remaining', { n: state.expectationCount - entries.length }));
      text(el('counts'), tr('checkpoints', { n: state.checkpointCount }) + ' · ' + tr('pins', { n: state.pinCount }));
      el('issues').hidden = !state.issueCount;
      text(el('issues'), tr('issues', { n: state.issueCount }));
      el('notice').hidden = !notice;
      if (notice) text(el('notice'), tr(notice));
      el('warning').hidden = !warning;
      text(el('missing'), warning ? tr(state.issueCount ? 'unsupported-input' : 'missing') : '');
      const left = state.corner.endsWith('l'); const top = state.corner.startsWith('t');
      host.style.left = left ? '12px' : ''; host.style.right = left ? '' : '12px';
      host.style.top = top ? '12px' : ''; host.style.bottom = top ? '' : '12px';
      for (const control of root.querySelectorAll('button,select')) if (state.stopped) control.disabled = true;
      for (const id of ['finish', 'finish-mini', 'incomplete']) el(id).disabled = state.stopped || finishing;
    };
    const update = (view) => {
      if (!view || !Number.isInteger(view.revision) || view.revision < state.revision) return;
      if (view.stepCount !== state.stepCount) notice = null;
      state = { ...state, ...view };
      window.__buggpsToolbarState = state;
      render();
    };
    const submit = async (event) => {
      try { const view = await window.__buggpsRecord(event); update(view); return true; }
      catch { notice = 'disconnected'; render(); return false; }
    };
    window.__buggpsUpdateToolbar = update;
    window.__buggpsSelectionChanged = render;
    window.__buggpsFormatMessage = tr;
    window.__buggpsToast = (code) => {
      if (pickerCollapsed && ['expectation-set', 'checkpoint-set', 'selection-cancelled', 'secret-refused'].includes(code)) {
        pickerCollapsed = false; state.collapsed = false;
        void submit({ type: 'toolbar', collapsed: false });
      }
      notice = code; render();
      if (['expectation-set', 'checkpoint-set', 'selection-cancelled', 'secret-refused'].includes(code)) window.__buggpsRestoreApplicationFocus?.();
    };
    const closeChoices = () => {
      root.querySelector('details').open = false;
      if (window.__buggpsPickKind) el(state.collapsed ? 'cancel-mini' : 'cancel').focus({ preventScroll: true });
      else if (!window.__buggpsRestoreApplicationFocus?.()) root.querySelector('button[data-k="text"]').focus({ preventScroll: true });
    };
    const cancelPick = () => { window.__buggpsCancelPick?.(); render(); };
    for (const id of ['cancel', 'cancel-mini']) el(id).addEventListener('click', cancelPick);
    const finish = async (incomplete = false) => {
      if (state.stopped || finishing) return;
      if (window.__buggpsPickKind) window.__buggpsCancelPick?.();
      finishing = true; render();
      let timer;
      try {
        const acknowledged = (async () => { await window.__buggpsFlushRecording?.(); return window.__buggpsGetState(); })();
        try { update(await Promise.race([acknowledged, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Recording acknowledgement timed out')), 3000); })])); }
        catch {
          if (!incomplete) { notice = 'syncFailed'; return; }
          if (!await submit({ type: 'capture-issue', code: 'recording-connection', message: 'Recording events were not fully acknowledged before finishing; this draft is incomplete.' })) return;
        }
        if (!incomplete && (!state.positive || state.issueCount)) {
          warning = true; state.collapsed = false;
          await submit({ type: 'toolbar', collapsed: false }); return;
        }
        window.__buggpsPickKind = null;
        warning = false;
        await submit({ type: 'stop' });
      } finally {
        clearTimeout(timer);
        finishing = false; render();
      }
    };
    for (const id of ['finish', 'finish-mini']) el(id).addEventListener('click', () => void finish());
    el('incomplete').addEventListener('click', () => void finish(true));
    el('continue').addEventListener('click', () => { warning = false; render(); });
    el('collapse').addEventListener('click', () => { pickerCollapsed = false; state.collapsed = !state.collapsed; render(); void submit({ type: 'toolbar', collapsed: state.collapsed }); });
    el('language').addEventListener('change', () => { state.language = el('language').value; render(); void submit({ type: 'toolbar', language: state.language }); });
    el('move').addEventListener('click', () => { const corners = ['br', 'bl', 'tl', 'tr']; state.corner = corners[(corners.indexOf(state.corner) + 1) % corners.length]; render(); void submit({ type: 'toolbar', corner: state.corner }); });
    el('pin').addEventListener('click', () => { void submit({ type: 'pin' }); notice = 'key-set'; render(); closeChoices(); });
    for (const button of root.querySelectorAll('button[data-k]')) button.addEventListener('click', () => {
      notice = null; warning = false;
      if (button.dataset.k === 'no-page-error') {
        window.__buggpsPickKind = null; void submit({ type: 'expect', expectation: { kind: 'no-page-error' } }); notice = 'no-error-set';
      } else {
        window.__buggpsPickKind = button.dataset.k;
        pickerCollapsed = !state.collapsed;
        state.collapsed = true;
        void submit({ type: 'toolbar', collapsed: true });
      }
      render();
      closeChoices();
    });
    render();
    update(window.__buggpsToolbarState);
    Promise.resolve(window.__buggpsGetState()).then(update).catch(() => { notice = 'disconnected'; render(); });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
}

export const TOOLBAR_SCRIPT = '(' + installToolbar.toString() + ')(' + JSON.stringify(messages) + ');';
