# Regression checks

Run the dependency-free logic suites from the project directory:

```sh
node --test tests/*.test.cjs
```

The optional browser suite requires `playwright` and its Chromium browser:

```sh
node tests/browser-regression.cjs
```

If Playwright is installed in a shared runtime, set `NODE_PATH` to that
runtime's `node_modules` directory before running the browser suite.

The browser suite serves project files through intercepted requests and mocks
Firebase entirely. It never connects to the production Firebase project.
It checks draft retention, account isolation, historical edits, safe text
rendering, report filters, transactional retries, keyboard/mouse/touch wallet
ordering, modal focus, and small-screen layout. Screenshots are saved in the
operating system's temporary directory.

The mock exercises client behavior and transaction retries; it does not verify
deployed Firestore rules, real network timing, or browser-specific mobile bugs.
