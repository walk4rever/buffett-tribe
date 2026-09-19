import { describe, it, expect } from "vitest";
import { extractHeadings } from "@/lib/extract-headings";

describe("extractHeadings", () => {
  it("should extract h2 and h3 headings with ids", () => {
    const html = `
      <h1 id="title">Title</h1>
      <h2 id="section-1">Section 1</h2>
      <p>Content</p>
      <h3 id="subsection-1-1">Subsection 1.1</h3>
      <h2 id="section-2">Section 2</h2>
      <h3 id="subsection-2-1">Subsection 2.1</h3>
    `;

    const headings = extractHeadings(html);

    expect(headings).toEqual([
      { id: "section-1", text: "Section 1", level: 2 },
      { id: "subsection-1-1", text: "Subsection 1.1", level: 3 },
      { id: "section-2", text: "Section 2", level: 2 },
      { id: "subsection-2-1", text: "Subsection 2.1", level: 3 },
    ]);
  });

  it("should ignore headings without ids", () => {
    const html = `
      <h2 id="with-id">With ID</h2>
      <h2>Without ID</h2>
      <h3 id="another">Another</h3>
    `;

    const headings = extractHeadings(html);

    expect(headings).toEqual([
      { id: "with-id", text: "With ID", level: 2 },
      { id: "another", text: "Another", level: 3 },
    ]);
  });

  it("should ignore h1 headings", () => {
    const html = `
      <h1 id="title">Title</h1>
      <h2 id="section">Section</h2>
    `;

    const headings = extractHeadings(html);

    expect(headings).toEqual([{ id: "section", text: "Section", level: 2 }]);
  });

  it("should return empty array for content without h2/h3", () => {
    const html = `
      <h1 id="title">Title</h1>
      <p>Content</p>
    `;

    const headings = extractHeadings(html);

    expect(headings).toEqual([]);
  });

  it("should handle nested elements in headings", () => {
    const html = `
      <h2 id="section"><strong>Bold</strong> and <em>italic</em></h2>
    `;

    const headings = extractHeadings(html);

    expect(headings).toEqual([
      { id: "section", text: "Bold and italic", level: 2 },
    ]);
  });
});
