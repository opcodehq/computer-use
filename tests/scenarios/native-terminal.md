Use ONLY the jev desktop MCP tools to complete this GUI acceptance test in
JevTerminalTest. The user continues working in another app: background delivery
only, no foreground actions, no shell tools, no global input, no other apps.

1. List windows, observe the exact window, and use desktop_act/Jev to press
   Open terminal. Verify its input field becomes available.
2. Use desktop_click to focus the Terminal input field without activating the
   app. Observe fresh state and require that field to be focused.
3. Use desktop_type with exactly `echo JEV_TEST_BACKGROUND_917`.
4. With fresh refs, send Enter through desktop_key into that exact input field.
5. Use desktop_wait exactLine to verify `JEV_TEST_BACKGROUND_917` as output.
   Inspect context to distinguish the output from the typed echo command.
6. Close the terminal using its observed Close terminal control. Verify its
   input and close button disappear from the observation.

If Jev returns noMatch, inspect and use desktop_execute with an exact ref. If a
semantic press produces no effect, inspect before considering desktop_click.
Never blindly replay an action. No fixed step limit. Finish with pass/fail and
observed evidence for each step. Do not claim success from delivery alone.
