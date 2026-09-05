import Link from "next/link";
import { FileQuestion } from "lucide-react";

export default function NotFound() {
  return (
    <main className="grid min-h-[70dvh] place-items-center px-4 py-12 text-center"><div><span className="mx-auto grid size-12 place-items-center rounded-full bg-[#eee9ff] text-[#5b37d2]"><FileQuestion aria-hidden="true" className="size-5" /></span><h1 className="mt-4 text-xl font-bold">Record not found</h1><p className="mt-2 text-sm text-[#686470]">It may have been removed or the address is incorrect.</p><Link href="/" className="button-primary mt-5">Return to overview</Link></div></main>
  );
}
