"use client";
import dynamic from "next/dynamic";

// WebGL and Web Audio only exist in the browser, so the board never renders on the server
const Board = dynamic(() => import("./Board"), { ssr: false });

export default function Page() {
  return <Board />;
}
