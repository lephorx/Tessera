import { redirect } from "next/navigation"

// the dashboard lives at /servers, next to /servers/new and each server
export default function Home() {
  redirect("/servers")
}
