# BugGPS · dsh-bug-gps

[简体中文](../../README.md) · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md)

**Registra el problema. Verifica la corrección con la expectativa original.**

BugGPS es un plugin para DeepSeek Harness (DSH), orientado a problemas del navegador ya identificados. Registra acciones y resultados esperados, establece un fallo reproducible y comprueba el código modificado con las mismas condiciones y una versión base independiente.

> Los siguientes comandos instalan una revisión fija de Git. Usa la ruta npm cuando la versión solicitada esté publicada. Consulta el [estado de publicación](https://github.com/lijiaqi-AI-Product-Manager/dsh-bug-gps/issues/4). La compatibilidad se limita a DSH **0.2.1-rc.5**, `headless` / `web`.

```bash
dsh plugin --profile web add 'git+https://github.com/lijiaqi-AI-Product-Manager/dsh-bug-gps.git#306971c417e0bdca3ac930507c1bb57e2236dcbf'
dsh --profile web --dump-config
```

El ejemplo usa `web`; cambia ambos comandos a `headless` para una instancia sin interfaz. Confirma la capa de configuración, reinicia esa instancia y llama a `buggps_status` en el proyecto Git de destino. El escritorio requiere una validación aparte.

[Instalación y eliminación (chino/inglés)](../installation.md) · [Registros históricos (revisión fija)](../verification/1.0.0/README.md). Cada registro identifica su fuente y alcance; las comprobaciones actuales están en la lista de publicación.

Tras actualizar, vuelve a grabar los registros antiguos. El bloqueo comprueba el texto, los valores y la visibilidad capturados. Las acciones en marcos u otras pestañas dejan la grabación incompleta.

![BugGPS](../media/buggps-demo.gif)

La demostración controla mediante un script el ejemplo incluido con un fallo intencional y aplica cambios preparados. Las páginas y las salidas son reales, pero los fotogramas se han editado: la duración del vídeo no es el tiempo de ejecución. Las tarjetas de resultado, el cursor y los subtítulos son elementos de presentación.

## Probar el ejemplo incluido

Requiere Node.js ≥20, Git y Microsoft Edge o Google Chrome instalado. Las comprobaciones documentadas de Windows usan Node 24.22.0 y Edge 156; no acreditan todos los navegadores ni sistemas.

```bash
git clone https://github.com/lijiaqi-AI-Product-Manager/dsh-bug-gps.git
cd dsh-bug-gps
git checkout --detach 306971c417e0bdca3ac930507c1bb57e2236dcbf
npm ci
node bin/buggps.js demo ../buggps-demo
node bin/buggps.js doctor --repo ../buggps-demo
```

`demo` crea un repositorio Git independiente e indica los siguientes pasos. Inicia el servidor de desarrollo, abre el proyecto en DSH y registra el problema y su resultado esperado. `doctor` comprueba el entorno, el navegador, los comandos, la configuración y el puerto. Los borradores existentes pueden bloquearse sin otra grabación interactiva.

## Cargar el plugin en DSH

Para cargar con `dsh plugin`, también necesitas **pnpm ≥10** en PATH.

```bash
dsh plugin --profile PROFILE add "/absolute/path/to/dsh-bug-gps"
dsh --profile PROFILE --dump-config
```

Sustituye `PROFILE` por el perfil que realmente utiliza tu instancia y la ruta por la ubicación absoluta del código. Reinicia esa instancia y llama a `buggps_status` en el proyecto. Una entrada de configuración no demuestra que las herramientas se hayan cargado.

La aplicación de escritorio y la CLI pueden usar perfiles distintos. Instalar en `web` no confirma la instalación en el escritorio. Comprueba la versión DSH incluida y el perfil real antes de usar su gestor de plugins. El flujo de la CLI oficial rc.5 se ha ejecutado; la ruta de instalación de escritorio aún no ha completado su aceptación independiente.

## Flujo de trabajo

1. **Registrar:** guardar las acciones, la configuración del navegador y las expectativas explícitas. Los puntos de control conservan estados intermedios; los pasos clave se mantienen al acortar.
2. **Bloquear:** iniciar la aplicación con el comando `serve` guardado y reproducir el mismo fallo tres veces por defecto.
3. **Corregir:** DSH modifica el código de la aplicación con tu configuración existente.
4. **Verificar:** repetir tres veces por defecto la grabación completa con las condiciones originales. Una versión base independiente también debe reproducir el fallo bloqueado para obtener `VERIFIED`.

## Interpretar el resultado

| Resultado | Significado |
|---|---|
| `VERIFIED` | Las comprobaciones pasan y una nueva ejecución de la versión base reproduce el fallo original. |
| `PASSED_UNBOUND` | Las comprobaciones pasan en un servidor externo cuyo código no puede vincularse al parche. |
| `NEEDS_REVIEW` | Requiere revisión: desencadenante desactivado, solo comprobaciones de ausencia, cambio de localizador o evaluador, o fallo del control base. |
| `STILL_FAILING / DIFFERENT_FAILURE` | Persiste el fallo original o falla otro síntoma o punto de control. |
| `TEST_INVALID / ENV_BLOCKED` | Definición de prueba inutilizable o entorno bloqueado; no es una reproducción válida. |
| `FLAKY / STALE / CASE_TAMPERED` | Resultados inconsistentes, código cambiado durante la verificación o evidencias fijadas modificadas. |
| `NO_CODE_CHANGE` | Código sin cambios desde el bloqueo. Continuar la corrección solicitada; si solo se pidió verificar, informar que no hubo cambios. |
| `BUDGET_EXHAUSTED / ABORTED` | Presupuesto agotado o tarea cancelada; la evidencia está incompleta. |

`buggps_status` muestra la ejecución válida que terminó más recientemente. Un resultado histórico solo sigue siendo aplicable si coinciden el código, el caso, los datos bloqueados y el evaluador; `not_current_reasons` explica las diferencias. `NO_CODE_CHANGE` conserva el significado de código sin cambios y no confirma una corrección.

Las vistas previas se limitan a 12.000 caracteres y muestran primero el resultado, las referencias y la siguiente acción. Si aparece `output_preview: abbreviated`, lee el borrador, caso, registro o parche referenciado. Los resultados estructurados completos y las comprobaciones no cambian. No reconstruyas pruebas ni apliques parches a partir del texto abreviado.

## Alcance y límites

- El resultado cubre el escenario registrado; no demuestra que la aplicación esté libre de otros fallos.
- El estado del frontend debe poder reiniciarse. Una repetición de calentamiento precede a los intentos contados; las operaciones que modifican datos del servidor quedan fuera del alcance aceptado.
- Las condiciones finales se muestrean durante 1.000 ms por defecto, con un intervalo objetivo de 50 ms. No se cubren los huecos ni los cambios posteriores.
- El acortamiento devuelve una ruta más corta confirmada dentro de un presupuesto. La grabación completa sigue siendo la referencia; no se garantiza un mínimo global ni causalidad.
- Las instantáneas siguen Git y excluyen dependencias y configuración ignoradas. Las dependencias compartidas y entradas del entorno del control base se registran aparte. Un worktree no es un entorno aislado de seguridad.
- Los datos reconocidos como sensibles se guardan como referencias al entorno. La detección es imperfecta; revisa los artefactos antes de compartirlos.
- Se comprueba la coherencia de definiciones y registros. La protección del shell es limitada; los hashes no son una prueba imposible de falsificar.

[Configuración, todos los resultados y límites detallados](../../README.md)

## Evidencias y comentarios

Las pruebas, la instalación del paquete y los doce casos históricos fijos tienen registros separados. Los casos contribuyeron a mejorar la implementación: son una regresión ampliada, no una evaluación a ciegas. Los fallos permanecen en el denominador.

[Guía de casos](../../bench/RECORDING-GUIDE.md) · [Registros de ejecución](../../bench/results) · [Regresiones del navegador](../../test/counterexamples.test.js) · [Informar de un problema](https://github.com/lijiaqi-AI-Product-Manager/dsh-bug-gps/issues/new)

Incluye la versión DSH, el sistema operativo, el comportamiento esperado, el veredicto exacto y una reproducción segura. Elimina credenciales y datos privados.

Si BugGPS te ayudó a verificar una corrección, una Star ayuda a que otros lo descubran.

[Compatibilidad del entorno y comprobación del paquete](../host-compatibility.md)

MIT · [LICENSE](../../LICENSE)


[Reproducir la verificación de la corrección de ChartDB](../../bench/repairs/chartdb-dbml-index/README.md) · [DSH rc.5](../../bench/results/account-project-chartdb-dbml-index-2026-11-03.json) · [Caso ChartDB: AGPLv3](../../bench/repairs/chartdb-dbml-index/LICENSE)
