# Racket detail profiling

The racket detail route has an opt-in structured profiler for application
functions, PostgREST queries, and Supabase Auth requests. It is disabled by
default and adds no console output until enabled.

## Run it

In PowerShell:

```powershell
$env:RACKET_DETAIL_PROFILE = "1"
$env:RACKET_DETAIL_PROFILE_PATH = "/vi/rackets/li-ning/li-ning-tectonic-6"
npm run dev
```

Then load the path named by `RACKET_DETAIL_PROFILE_PATH`. For production-mode
cache behaviour, build first and run `npm start` with the same two variables.

Every event is one JSON object prefixed by `[racket-detail-profile]`. Function
events report the complete async duration. Query events distinguish:

- `service: "rest"`: one PostgREST/Postgres query.
- `service: "auth"`: a Supabase Auth request, not an application SQL query.

Query events include the client source, table/resource, HTTP status, returned
content range, and duration. Secrets, cookies, headers, filters, and response
bodies are deliberately omitted.

Cache Components can replay `console.*` output from cached functions. The
profiler writes directly to stdout so a cache replay cannot inflate the query
count. Development mode can still run `generateStaticParams` work that a
production request does not; use a production build for final query counts.
