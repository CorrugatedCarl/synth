// Test-process guard (owner I; RULINGS2 "Performance": the suite must stay reliable under parallel load). node 24's V8
// intermittently crashes a test process (SIGSEGV in ClearStaleLeftTrimmedPointerVisitor while a garbage collection runs
// from a stack-guard interrupt in Sparkplug baseline code: Builtins_BaselineOutOfLinePrologue → Runtime_StackGuardWithGap
// → MarkCompact / Scavenge → InternalFrame::Iterate), about once per full parallel run, in whichever file it hits
// (sx-spec, sx-mod, fx-mods2, serum-ui, serum-dsp seen; macOS crash reports in ~/Library/Logs/DiagnosticReports). The
// baseline tier is switched off for the test processes: code runs in the interpreter until TurboFan optimises it, as in
// the browsers' worklets the site targets, and the crashing frame type never exists. Every test file imports this module
// first (tests/lint.test.mjs checks it); it only sets the flag and touches nothing else.
import v8 from 'node:v8';

v8.setFlagsFromString('--no-sparkplug');
