import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/admin-auth";
import { redirect } from "next/navigation";
import {
  AdminAnnouncementsManager,
  type RecipientUserOption,
  type AnnouncementHistoryItem,
} from "@/components/admin/AdminAnnouncementsManager";
import { isDeliverableEmail } from "@/lib/brand";

export const dynamic = "force-dynamic";

export default async function AdminAnnouncementsPage() {
  const auth = await getAdminSession();
  if (auth.status === "unauthenticated") {
    redirect("/auth/signin");
  }
  if (auth.status === "forbidden") {
    redirect("/");
  }

  const [users, announcements] = await Promise.all([
    prisma.user.findMany({
      where: {
        email: { not: null },
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.emailAnnouncement.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        subject: true,
        preheader: true,
        contentMarkdown: true,
        recipientMode: true,
        recipientsCount: true,
        successCount: true,
        failedCount: true,
        status: true,
        errorSummary: true,
        createdAt: true,
        updatedAt: true,
        sentAt: true,
      },
    }),
  ]);

  const validUsers: RecipientUserOption[] = users
    .filter((u): u is typeof u & { email: string } => isDeliverableEmail(u.email))
    .map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      createdAt: u.createdAt.toISOString(),
    }));

  const history: AnnouncementHistoryItem[] = announcements.map((a) => ({
    id: a.id,
    subject: a.subject,
    preheader: a.preheader,
    contentMarkdown: a.contentMarkdown,
    recipientMode: a.recipientMode,
    recipientsCount: a.recipientsCount,
    successCount: a.successCount,
    failedCount: a.failedCount,
    status: a.status,
    errorSummary: a.errorSummary,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    sentAt: a.sentAt ? a.sentAt.toISOString() : null,
  }));

  return (
    <div className="admin-page-container">
      <div className="admin-page-heading">
        <div>
          <h1 className="admin-page-title">产品发布与邮件广播</h1>
        </div>
      </div>

      <AdminAnnouncementsManager
        initialUsers={validUsers}
        initialHistory={history}
        adminEmail={auth.session.user.email || ""}
      />
    </div>
  );
}
