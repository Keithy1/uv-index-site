/**
 * The shell for text pages: guide, methods, about, privacy, terms.
 *
 * These are the pages a reader actually reads, so the measure is narrower than
 * the data pages and the vertical rhythm is looser. Everything else — header,
 * footer, disclaimer, theming — comes from Layout.
 */
import type { Child } from "hono/jsx";

import { Layout, ORIGIN } from "./Layout";

const PROSE_CSS = `
/* No narrower column of its own: text pages share the site's one column, so
   every page's edges line up with the header. */
.prose{max-width:none}
.prose h2{margin:30px 0 8px;font-size:1.2rem}
.prose h3{margin:22px 0 6px;font-size:1.02rem}
.prose p,.prose li{font-size:1.02rem;line-height:1.65}
.prose ul,.prose ol{padding-left:22px}
.prose li{margin:6px 0}
.prose table{border-collapse:collapse;width:100%;margin:12px 0}
.prose th,.prose td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);
font-size:.95rem}
.prose thead th{font-size:.78rem;text-transform:uppercase;letter-spacing:.04em;
color:var(--muted)}
.prose .updated{color:var(--muted);font-size:.875rem;margin-top:-2px}
.prose .note{border-left:3px solid var(--line);padding-left:14px;color:var(--muted)}
.band{display:inline-block;white-space:nowrap;padding:2px 9px;border-radius:999px;font-weight:600;
font-size:.85rem}
`;

interface Props {
  readonly title: string;
  readonly heading: string;
  readonly description: string;
  readonly path: string;
  /** Shown under the heading. Legal and methods pages need a date. */
  readonly updated?: string;
  readonly children?: Child;
}

export function Prose(props: Props) {
  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: props.title,
      description: props.description,
      url: `${ORIGIN}${props.path}`,
      inLanguage: "en",
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${ORIGIN}/` },
        { "@type": "ListItem", position: 2, name: props.heading, item: `${ORIGIN}${props.path}` },
      ],
    },
  ];

  return (
    <Layout
      title={props.title}
      description={props.description}
      path={props.path}
      lang="en"
      structuredData={structuredData}
    >
      <style dangerouslySetInnerHTML={{ __html: PROSE_CSS }} />
      <article class="prose">
        <h1>{props.heading}</h1>
        {props.updated && <p class="updated">Last updated {props.updated}</p>}
        {props.children}
      </article>
    </Layout>
  );
}
