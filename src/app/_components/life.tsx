"use client";

import type { User } from "next-auth";

export default function Life({ user: _user }: { user: User }) {
  return <div>Life</div>;
}
