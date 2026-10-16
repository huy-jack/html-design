# UX rules for the plugin reviewer

Read by the `ui-ux-reviewer` agent. Each rule has a test and a threshold, so a finding can carry numbers. Sources: W3C WCAG 2.2, NN/g form and empty-state guidelines, Baymard inline validation research.

## A. Forms (the Copy tab, Pick notes, search fields)

| Rule | Test | Threshold |
|---|---|---|
| Validate when the user leaves the field or acts, not while typing | When does an error show? | An error mid-typing is a finding |
| Error sits next to its field | Is the message under or beside the field? | Only at the top or bottom, or only in a dialog, is HIGH |
| Error uses color plus text or icon | Red only? | Color alone fails |
| Label position | Label above the field, outside it | Placeholder as the only label is a finding |
| Field edge contrast | Border against background | At least 3:1 (WCAG 1.4.11) |
| Focus state | Visible focus ring at 3:1, at least 2px | Missing is a finding |
| Never ask twice | Does the user type the same thing twice in one task? | Pre-fill or remember it |
| Explain unknown fields | A field whose meaning a first-time user cannot guess (an id, a slug) | Needs a hint line or an example, and a safe default |

## B. Empty states and first run

| Rule | Test | Threshold |
|---|---|---|
| Empty state teaches | Does an empty list say why it is empty and give the one next action as a button or exact steps? | A bare "nothing here" is MEDIUM; with no next step on the first run it is HIGH |
| The loop is visible | Can a new user see the whole loop (copy, pick, ask Claude) somewhere without reading docs? | Missing is HIGH for a tool whose steps span two apps |
| Next step across apps | When the next step is in another app (terminal, another tab), does the page say so in words? | Missing is MEDIUM |

## C. Feedback and status

| Rule | Test | Threshold |
|---|---|---|
| Result where the user looks | Does each action show its result in the place the user is looking at that moment? | Result only in a hidden tab or a log is HIGH |
| Status always visible | Session live or stopped, build ok or failed, saving | Hidden or color-only status is a finding |
| Wait over 1 s shows progress | A copy, a build, a countdown | No progress shown is MEDIUM |

## D. Access (WCAG 2.2 AA)

| Criterion | Threshold |
|---|---|
| Text contrast | 4.5:1 body, 3:1 for 18.66px bold or 24px and up |
| Non-text contrast (1.4.11) | Controls, field edges, focus rings, meaningful icons at least 3:1 |
| Target size (2.5.8) | At least 24 by 24px, or spaced so 24px circles do not overlap |
| Color alone | Selected, error and status never shown by color alone |
| Keyboard | Every action reachable by keyboard; shortcuts listed where the user can find them |

## E. Lists of many items (home grid, state list)

| Rule | Test |
|---|---|
| Find one in 200 | Search or filter, visible and keyboard reachable, with the match count |
| Selected item | The current item is obvious by more than color |
| Sort state | The active sort is visible and changes in one click |
| Previews | Thumbnails are big enough to recognise the screen, with a readable name |
