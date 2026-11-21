# Team code-mode activation and compatibility

Status: PR748 correction candidate, not deployed or independently accepted.

## Context

The owner chose code mode by default for members and observers on 2026-11-19. The original preset row used `disabled: !ctx.get('ptcRuntime')`. A Loader evaluates that condition while it creates the row; it does not import a skipped row when a provider appears later. The real preset registry then sees an enabled row with no fiber. Older tools also publish the same runtime service name but lack the split executor package/API. Neither problem changes the owner's default-mode decision.

## Decision

Both worker presets mount this package's `superagent-ptc` entry without a runtime-dependent YAML condition. Router and builder compositions remain unchanged.

- Require the existing tools, prompt and Loader services. On tools without `setExecutor`, leave native execution alone without resolving the new executor package.
- In a DSH profile, first apply the host's existing `prepareProfileEntries` compatibility preflight to the executor row with the same resolution base. A denial keeps native tools without importing the executor; an unavailable/broken preflight is a visible error, not permission to bypass it.
- Import only the host Loader's existing `@deepseek-ai/dsh-tool-executor-ptc` module. An absent optional package is a compatibility fallback with a warning; a broken module, missing transitive dependency or other import error remains an activation failure. There is no installation or alternative module search.
- Register a Cordis dependency on `ptcRuntime` inside the mounted entry. This child activates when a provider becomes ready, including after the preset was registered. Compatibility requires the supported language and program form, retained-state flag, and `release`/`resolve`/`run` methods, not just a truthy service name.
- Mount the host executor in the same preset scope. Its shared tool pipeline and the existing role guard still decide every nested call. This entry grants no tools, adds no runtime and changes no host configuration.
- If the entry is disposed while importing, do not start a child after the import finishes. Cordis owns child disposal on provider/scope removal and reactivation on replacement.

## Consequences and limits

Before the first compatible provider, a valid preset retains its inherited native executor. Old tools, an incompatible provider and an absent optional executor do not claim code mode. The host deliberately leaves an unavailable scoped executor after an active provider disappears; that state is fail-closed, not permission to fall back to native calls. A compatible replacement may restore the same scope through the ordinary lifecycle.

The optional package is resolved on entry activation. Installing it later requires the normal authorized plugin/preset reload; this code does not watch the filesystem or install dependencies. Unsupported or broken modules are not hidden by fallback. Host compatibility policy and the one-executor-per-scope rule remain in force.

## Checks

Project tests cover legacy tools with the real legacy runtime definition, ready/absent/late providers, incompatible runtime shape, missing/broken imports, replacement, scope removal and disposal during import. Preset tests pin both worker rows, unchanged router/builder compositions and the generated patch.

The existing smoke entry accepts an optional PTC check after building the candidate:

```bash
node scripts/verify-agent-presets-runtime.mjs <installed-dsh-package.json> --ptc
```

It uses that explicitly supplied installation's real Loader, preset registry, tools and executor with scripted in-memory runtime bindings; it does not open a session, call a model, run arbitrary code in a subprocess sandbox, connect A2A, or activate this candidate in a live host. Run it inside the project's existing test-lifecycle entry. The checks and author tests do not substitute for non-author exact-SHA review, clean-install/package gates, formal release verification or operational acceptance.
