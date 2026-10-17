import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const SAFE_PROTOCOL = /^(https?|ircs?|mailto|xmpp)$/i;

/** Returns a relative, fragment, or explicitly allowed URL. */
export function safeMarkdownHref(href: unknown): string | undefined {
  if (typeof href !== "string") return undefined;
  const value = href.trim();
  const colon = value.indexOf(":");
  if (colon === -1) return value;
  const slash = value.indexOf("/");
  const question = value.indexOf("?");
  const hash = value.indexOf("#");
  if (
    (slash !== -1 && colon > slash) ||
    (question !== -1 && colon > question) ||
    (hash !== -1 && colon > hash) ||
    SAFE_PROTOCOL.test(value.slice(0, colon))
  )
    return value;
  return undefined;
}

const components: Components = {
  a: ({ href, children }) => {
    const safe = safeMarkdownHref(href);
    if (!safe) return <>{children}</>;
    return (
      <a
        href={safe}
        target="_blank"
        rel="noopener noreferrer"
        className="text-dbz-orange underline underline-offset-2 transition-colors hover:text-white"
      >
        {children}
      </a>
    );
  },
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-bold text-white">{children}</strong>,
  em: ({ children }) => <em className="italic text-white/90">{children}</em>,
  ul: ({ children }) => <ul className="mb-2 list-inside list-disc space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-inside list-decimal space-y-1">{children}</ol>,
  li: ({ children }) => <li className="text-gray-400">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-dbz-orange/60 pl-3 italic text-white/70">{children}</blockquote>
  ),
  code: ({ children }) => (
    <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[0.85em] text-dbz-orange">{children}</code>
  ),
  h1: ({ children }) => <span className="mb-1 block font-bold text-white">{children}</span>,
  h2: ({ children }) => <span className="mb-1 block font-bold text-white">{children}</span>,
  h3: ({ children }) => <span className="mb-1 block font-bold text-white">{children}</span>,
};

/** Markdown rendering with raw HTML and inline images disabled. */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} disallowedElements={["img"]} unwrapDisallowed components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
