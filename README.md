# TrendLens manufacturing dashboard

## Local development

```sh
pnpm install
pnpm dev
```

Create a production bundle with `pnpm build` and run the automated checks with `pnpm test`.

## Prototype settings persistence

TrendLens currently has no backend or database. User profile and company settings are saved independently in this browser's `localStorage` under `trendlens.profile.v1` and `trendlens.company.v1`. They load again when the page is refreshed. This is prototype-only storage: browser localStorage is not secure, is not sent to a server, and is not shared across users or devices. Clearing browser site data removes these settings. A production deployment should replace this adapter with authenticated server-side storage.
