# Recover a workflow

Keep a short record of completed outcomes, remaining outcomes, and the newest
observed state. Resolve the local obstacle, then give `task` the remaining complete
workflow. A task has its own driver: start/reuse a helper session and observe to
obtain fresh refs before using exact-ref recovery commands.

| Outcome | Next step |
| --- | --- |
| Low confidence / no matching control | Inspect the returned state. If the exact supported control is clear, use a fresh helper observation and `execute`; otherwise improve app/window selection or resolve the ambiguity. |
| Partial observation | Use `windows` to choose the right window, or increase `nodeLimit`. Use visual observation only if AX omits the needed control. |
| Stale ref | Observe in the current helper and select again; preserve the task goal. |
| `UserActiveInTarget` | An active task can wait for the user to leave the app. Keep the run alive; do not launch competing inputs. |
| `WindowOffScreen` | Explain that the target window must be unminimized on the current desktop; never switch Spaces or activate it behind the user's back. |
| Unknown delivery / disconnect | Observe before deciding whether anything remains. Never blindly replay a save, submit, or creation. |
| No progress / repeated state | Inspect whether the previous action worked. Try another observed supported route; do not restart already completed setup. |
| Login, verification, secure input, unsupported upload | State exactly which human input or driver capability is missing. Do not invent values or bypass a verification. |
| Claimed success with incomplete evidence | Inspect the final state. A save should have a saved-state indicator, confirmation, or persisted result; dispatch alone is insufficient. |

Only a specific missing capability or unavailable information justifies handing
the task back. Report completed work and the precise next fix. General website
signup is not guaranteed: Jev's native runner does not include a general browser
DOM driver, secure-field support, or a separate isolated desktop.
