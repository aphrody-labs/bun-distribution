import Link from "next/link";
import { Counter } from "./counter";
import { Form } from "./form";

export const metadata = { title: "Home" };

export default function Home() {
  return (
    <main>
      <h1>Home page</h1>
      <Counter start={3} />
      <Form />
      <Link href="/blog/first">First post</Link>
    </main>
  );
}
