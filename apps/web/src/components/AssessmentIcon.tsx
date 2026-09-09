import type { AssessmentIcon as IconKey, OperationalDomain } from "@cloudops/contracts";

// Static, reviewed paths; never render markup or URLs supplied by a manifest.
const paths: Record<IconKey, readonly string[]> = {
  users: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87", "M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM16 3a4 4 0 0 1 0 8"],
  shield: ["M12 2.5 20 6v5.2c0 5.1-3.3 8.9-8 10.3-4.7-1.4-8-5.2-8-10.3V6l8-3.5Z", "m8.5 12 2.2 2.2 4.8-5"],
  link: ["M10 13a5 5 0 0 0 7 .2l3-3a5 5 0 0 0-7-7l-2 2", "M14 11a5 5 0 0 0-7-.2l-3 3a5 5 0 0 0 7 7l2-2"],
  activity: ["M2 12h4l3-9 6 18 3-9h4"],
  key: ["M15 8a5 5 0 1 1-10 0 5 5 0 0 1 10 0ZM13.5 11.5 22 20M18 16l-2 2M20 18l-2 2"],
  search: ["M18 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0ZM16 16l6 6"],
  server: ["M3 3h18v7H3ZM3 14h18v7H3ZM6 6h1M6 17h1"],
  database: ["M21 5c0 2-4 3-9 3S3 7 3 5s4-3 9-3 9 1 9 3ZM3 5v14c0 2 4 3 9 3s9-1 9-3V5M3 12c0 2 4 3 9 3s9-1 9-3"],
  network: ["M9 2h6v6H9ZM2 16h6v6H2ZM16 16h6v6h-6ZM12 8v4M5 16v-4h14v4"],
  cost: ["M12 2v20M17 6H9a3 3 0 0 0 0 6h6a3 3 0 0 1 0 6H6"],
  code: ["m8 5-6 7 6 7M16 5l6 7-6 7M14 3l-4 18"],
};
const defaults: Record<OperationalDomain, IconKey> = {
  dashboard: "activity", govops: "users", secops: "shield", finops: "cost", devops: "code",
};

export function AssessmentIcon({ icon, domain }: { readonly icon?: IconKey; readonly domain: OperationalDomain }) {
  const key = icon ?? defaults[domain];
  return <svg viewBox="0 0 24 24" focusable="false" data-icon={key}>
    {paths[key].map((d, index) => <path key={index} d={d} />)}
  </svg>;
}
