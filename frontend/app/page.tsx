import { redirect } from "next/navigation";

// Root URL skips the splash screen and goes straight to the login screen.
export default function Home() {
  redirect("/login");
}
