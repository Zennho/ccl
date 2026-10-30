# Launcher usability improvements

**Goal:** Implement the six selected interaction improvements without changing download, account, persistence or game launch semantics.

- Home: choose an installed version in place; avatar opens account and appearance directly, where saved/offline accounts can be switched. Preserve cached avatar and authentication state.
- Content: separate discovery and installed lists, keep search form and current target mounted, retain tab and filter state across background renders. Preserve IME and all actions.
- Install: show target, selected loader and add-ons, and honest compatibility/dependency status; list declared direct dependency IDs and resolve transitive dependencies during installation. Never assert unknown compatibility.
- Downloads: group active and finished, prioritize failed results, keep cancellation/retry semantics and show unknown progress honestly.
- Account appearance: label local preview versus online account texture and cape; do not claim offline game synchronization without tracking it.
- Settings/Java: prioritize common settings, collapse advanced controls without disabling form submission; show Java requirements only when reliably known, otherwise explicitly unknown.
- Tests: exercise direct version/account switching, content tabs and preserved filters, installation summary, grouping, appearance statuses and hidden advanced fields. Run `npm run check` and inspect behavior at desktop minimum window width.
