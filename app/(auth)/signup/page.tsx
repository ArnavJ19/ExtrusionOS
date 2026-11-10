import { redirect } from "next/navigation";

// Public sign-up is closed: ExtrusionOS is dedicated to Omalco Extrusion.
// New staff are added through invitations by the owner/admin.
export default function SignupPage() {
  redirect("/login");
}
