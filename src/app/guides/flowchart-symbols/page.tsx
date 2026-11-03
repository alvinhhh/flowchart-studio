import type { Metadata } from "next";
import Link from "next/link";
import { PRODUCT } from "@/lib/config";
import { PublicGuide } from "../_components/public-guide";

const title = "Flowchart symbols and their meanings";
const description = "Use start/end, process, decision, input/output, and connector symbols to make a flowchart readable. Learn when to use each shape with programming examples.";
const path = "/guides/flowchart-symbols";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: path },
  openGraph: { title, description, url: path, type: "article", siteName: PRODUCT.name },
  twitter: { card: "summary_large_image", title, description },
};

const symbols = [
  { kind: "terminal", name: "Start / End", form: "Rounded terminal", meaning: "The beginning or end of a flow.", example: "Start; End; Return result" },
  { kind: "process", name: "Process", form: "Rectangle", meaning: "An action, calculation, or assignment.", example: "total = price × quantity" },
  { kind: "decision", name: "Decision", form: "Diamond", meaning: "A condition that selects the next route.", example: "Is total ≥ 100?" },
  { kind: "io", name: "Input / Output", form: "Parallelogram", meaning: "Data entering or leaving the algorithm.", example: "Read quantity; Show total" },
  { kind: "function", name: "Function", form: "Rectangle with side lines", meaning: "A named routine whose internal steps are described elsewhere.", example: "calculateTax(total)" },
  { kind: "database", name: "Database", form: "Cylinder", meaning: "Stored data, such as records read from a database.", example: "Customer records" },
  { kind: "connector", name: "Connector", form: "Small circle", meaning: "A labeled continuation elsewhere on the same page.", example: "A, paired with another A" },
] as const;

function SymbolIcon({ kind }: { kind: typeof symbols[number]["kind"] }) {
  return <svg viewBox="0 0 120 70" className="guide-symbol" aria-hidden="true" focusable="false"><g fill="white" stroke="currentColor" strokeWidth="1.5">
    {kind === "terminal" && <rect x="10" y="14" width="100" height="42" rx="21" />}
    {kind === "process" && <rect x="10" y="14" width="100" height="42" />}
    {kind === "decision" && <path d="m60 6 50 29-50 29L10 35Z" />}
    {kind === "io" && <path d="M28 14h82L92 56H10Z" />}
    {kind === "function" && <><rect x="10" y="14" width="100" height="42" /><path d="M23 14v42m74-42v42" /></>}
    {kind === "database" && <><path d="M20 18v34c0 13 80 13 80 0V18" /><ellipse cx="60" cy="18" rx="40" ry="11" /></>}
    {kind === "connector" && <circle cx="60" cy="35" r="23" />}
  </g></svg>;
}

export default function SymbolsGuide() {
  return <PublicGuide title={title} description={description} path={path} relatedPath="/guides/how-to-draw-a-flowchart" relatedTitle="How to draw a programming flowchart">
    <section><h2>Start with four basic symbols</h2><p>Most simple programming flowcharts need a terminal for Start and End, rectangles for actions, diamonds for conditions, and parallelograms for input or output. Arrows connect the symbols in the order the algorithm follows.</p><p>Choose shapes by the role of the step. “Read age” is input, “age = age + 1” is a process, and “Is age ≥ 18?” is a decision. Use short labels that say what happens or what is being tested.</p></section>
    <section><h2>Common flowchart shapes</h2><div className="guide-table-wrap" tabIndex={0} role="region" aria-label="Flowchart symbols table"><table className="guide-symbol-table"><caption>Common symbols, uses, and example labels</caption><thead><tr><th scope="col">Symbol</th><th scope="col">Meaning</th><th scope="col">Example label</th></tr></thead><tbody>{symbols.map(symbol => <tr key={symbol.kind}><th scope="row"><SymbolIcon kind={symbol.kind} /><span>{symbol.name}</span><small>{symbol.form}</small></th><td>{symbol.meaning}</td><td>{symbol.example}</td></tr>)}</tbody></table></div><p>A database symbol names a store of data; an action such as “Save customer record” can be a process connected to that store. Keep the distinction between data and the operation that reads or changes it.</p></section>
    <section><h2>Arrows show the direction of control</h2><p>An arrow means “continue here.” Draw the main sequence in a consistent direction, usually from top to bottom. Give each arrow a visible destination. A line crossing another line should not imply that the two routes join.</p><p>For long routes, a pair of connectors with the same label can replace a line that would otherwise cross the page. Use a different label for each continuation pair. An off-page connector indicates a continuation on another page; include a page or destination reference so the reader can find it.</p></section>
    <section><h2>Decision symbols need clear outcomes</h2><p>A decision should contain a test with distinct outcomes. For a two-way branch, write “Is password valid?” in the diamond and label the outgoing arrows “Yes” and “No.” The Yes route might open the account page; the No route might show an error.</p><p>Place actions on the branches, outside the diamond. If a decision has more than two outcomes, label every route with its case, such as “Card,” “Cash,” and “Other.” When a class or team specifies a particular notation, use its conventions consistently.</p></section>
    <section><h2>Loops use decisions and return arrows</h2><p>A loop does not need a special shape. A decision checks whether to continue, a sequence of processes does the work, and an arrow returns to the check. One branch must lead to the next part of the program when the repetition is finished.</p><p>For example, “Is i ≤ 3?” can send Yes to “Print i,” then “i = i + 1,” then back to the decision. No goes to End. The <Link href="/guides/how-to-draw-a-flowchart">drawing guide</Link> shows this complete loop and explains how to trace its values.</p></section>
    <section><h2>Choose extra symbols when they add meaning</h2><p>Flowchart Studio includes 32 shapes. Beyond the basics, the palette includes documents, multiple documents, preparation, manual input, manual operation, storage, delay, display, annotations, and routing symbols.</p><p>Use a document for a report or page, a display for screen output when that distinction matters, and a note or annotation for an explanation beside the flow. Use a function symbol when the reader can understand the main sequence without seeing every step of the routine.</p><p>Specialized symbols are useful when they clarify the diagram for its audience. If a shape may be unfamiliar, label it clearly or add a legend. A small set of consistent symbols is enough for many algorithms.</p></section>
  </PublicGuide>;
}
