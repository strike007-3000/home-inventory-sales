# Contributing

Thanks for helping improve Home Inventory. The project is intentionally small and optimized for one or two non-technical users on phones and iPads.

## Before changing code

Open an issue for substantial changes. Describe the user problem and the smallest proposed solution. Bug fixes and documentation corrections can go directly to a pull request.

Keep these constraints intact:

- Use plain language in the interface.
- Keep primary touch targets at least 44 by 44 CSS pixels.
- Do not allow stock or money updates to partially succeed.
- Preserve transaction history instead of deleting completed records.
- Store INR amounts as integer paise and stock as whole units.
- Avoid new dependencies unless the existing platform cannot reasonably solve the problem.
- Do not commit real business data, exports, credentials, or environment files.

## Local development

Requirements: a current Node.js LTS release and npm.

```bash
npm install
npm run dev
```

Before submitting a pull request:

```bash
npm run check
```

Add or update the smallest relevant test when changing stock, sales, money, validation, or security behavior. For interface changes, test the affected workflow at phone and iPad widths and include screenshots when the visual change is material.

## Pull requests

Keep pull requests focused. Explain:

- What user problem is solved
- What changed
- How it was verified
- Any known limitation or deferred work

By contributing, you agree that your contribution is licensed under the repository's MIT License.
