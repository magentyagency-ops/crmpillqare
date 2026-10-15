import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";

export default async function Home() {
  const user = await getSessionUser();
  if (user) redirect(user.role === "SALES" ? "/aujourdhui" : "/tableau-de-bord");
  const users = await db.user.count();
  redirect(users === 0 ? "/installation" : "/login");
}
