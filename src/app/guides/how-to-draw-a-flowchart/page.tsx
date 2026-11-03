import type { Metadata } from "next";
import Link from "next/link";
import { PRODUCT, SOCIAL_IMAGE } from "@/lib/config";
import { PublicGuide } from "../_components/public-guide";

const title = "How to draw a programming flowchart";
const description = "Turn an algorithm into a flowchart: choose symbols, connect steps, label decision branches, and draw a loop with a clear exit.";
const path = "/guides/how-to-draw-a-flowchart";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: path },
  openGraph: { title, description, url: path, type: "article", siteName: PRODUCT.name, images: [SOCIAL_IMAGE] },
  twitter: { card: "summary_large_image", title, description, images: [SOCIAL_IMAGE] },
};

function LoopDiagram() {
  return <svg className="guide-diagram" viewBox="0 0 520 580" role="img" aria-labelledby="loop-title loop-description">
    <title id="loop-title">Flowchart for printing the numbers 1 through 3</title>
    <desc id="loop-description">Start, set i to 1, then check i is less than or equal to 3. On Yes, print i, increase i by 1, and return to the condition. On No, end.</desc>
    <defs><marker id="guide-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 7 3.5 0 7" fill="currentColor" /></marker></defs>
    <g fill="none" stroke="currentColor" strokeWidth="1.5" markerEnd="url(#guide-arrow)">
      <path d="M240 76V112" /><path d="M240 164V207" /><path d="M240 293V340" /><path d="M240 392V434" />
      <path d="M320 250H418V340" /><path d="M162 460H62V188H240V207" />
    </g>
    <g fill="white" stroke="currentColor" strokeWidth="1.5">
      <rect x="180" y="32" width="120" height="44" rx="22" />
      <rect x="162" y="112" width="156" height="52" />
      <path d="m240 207 80 43-80 43-80-43Z" />
      <path d="m177 340 152 0-26 52H151Z" />
      <rect x="162" y="434" width="156" height="52" />
      <rect x="358" y="340" width="120" height="44" rx="22" />
    </g>
    <g fill="currentColor" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="16">
      <text x="240" y="60">Start</text><text x="240" y="144">i = 1</text><text x="240" y="256">i ≤ 3?</text><text x="240" y="372">Print i</text><text x="240" y="466">i = i + 1</text><text x="418" y="368">End</text>
      <text x="261" y="319" fontSize="13">Yes</text><text x="365" y="239" fontSize="13">No</text>
    </g>
  </svg>;
}

export default function DrawingGuide() {
  return <PublicGuide title={title} description={description} path={path} relatedPath="/guides/flowchart-symbols" relatedTitle="Flowchart symbols and their meanings">
    <section><h2>What is a programming flowchart?</h2><p>A programming flowchart is a diagram of an algorithm. Shapes describe actions, inputs, outputs, and conditions. Arrows show which step happens next. A useful flowchart lets someone follow the logic from the start to an outcome without needing the source code.</p><p>Begin with one task, such as checking an input or printing a sequence. If the task contains several separate routines, draw the main flow first and name the routines as function calls.</p></section>
    <section><h2>1. Write the steps before drawing</h2><p>Describe the task in a few short lines. For an example that prints the numbers 1 through 3, the logic is:</p><pre aria-label="Pseudocode for a counting loop"><code>{`i = 1\nwhile i <= 3:\n    print i\n    i = i + 1`}</code></pre><p>Identify the initial value, repeated actions, and stopping condition. Here, the loop starts at 1, prints the current value, increases it, and stops when the value exceeds 3.</p></section>
    <section><h2>2. Choose a symbol for each kind of step</h2><ul><li><strong>Start / End:</strong> mark where the algorithm begins and finishes.</li><li><strong>Process:</strong> describe an action, such as <code>i = i + 1</code>.</li><li><strong>Decision:</strong> ask a condition, such as <code>i ≤ 3?</code>.</li><li><strong>Input / Output:</strong> read a value or show a result, such as <code>Print i</code>.</li></ul><p>Keep each label short and specific. “Check input” hides the test; “Is age ≥ 18?” makes the branches clear. See the <Link href="/guides/flowchart-symbols">flowchart symbols guide</Link> for examples of each shape.</p></section>
    <section><h2>3. Connect steps and label decision branches</h2><p>Arrange the main sequence from top to bottom. Connect each step with a directed arrow. A decision needs an outgoing route for each outcome, usually labeled “Yes” and “No” or “True” and “False.” Put the labels beside the arrows so the reader knows which route matches the condition.</p><p>For a simple if/else example, “Is score ≥ 60?” can lead to “Show pass” on Yes and “Show retry” on No. Both routes may then rejoin at End. Do not leave a branch without a next step or an explicit ending.</p></section>
    <section><h2>4. Draw a loop back to its condition</h2><p>A loop repeats part of the diagram. In the counting example, the Yes branch prints the value and increments it. The next arrow returns to the decision. The No branch leads to End.</p><figure className="guide-figure"><LoopDiagram /><figcaption>The condition is checked before each repetition. The output is 1, 2, then 3.</figcaption></figure><p>The increment matters: if <code>i</code> never changes, the condition stays true and the loop does not finish. In Flowchart Studio, connect different nodes to make a loop; a connection from a shape directly to itself is not supported.</p></section>
    <section><h2>5. Trace the diagram and save a backup</h2><p>Walk through the arrows with actual values. At <code>i = 1</code>, take Yes, print 1, and increment to 2. Repeat for 2 and 3. At 4, take No and end. Also check a boundary case: if the initial value were 4, the loop should end without printing a number.</p><p>Before finishing, check that every arrow has a destination, each decision has labeled outcomes, and each loop has an intended exit. Leave enough space between routes to avoid ambiguous crossings.</p><p>Flowchart Studio stores projects locally in this browser on this device. Download a JSON backup to keep an editable copy; use PNG for an image, SVG for scalable graphics, or PDF for printing. Clearing browser site data can remove local projects. The editor draws diagrams; it does not run the algorithm or generate code.</p></section>
  </PublicGuide>;
}
