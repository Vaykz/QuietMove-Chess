import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function MarkdownAnswer({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      allowedElements={[
        "p",
        "strong",
        "em",
        "del",
        "ul",
        "ol",
        "li",
        "h1",
        "h2",
        "h3",
        "h4",
        "blockquote",
        "code",
        "pre",
        "a",
        "hr",
        "br",
        "table",
        "thead",
        "tbody",
        "tr",
        "th",
        "td"
      ]}
      components={{
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        )
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
