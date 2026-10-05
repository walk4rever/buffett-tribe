import { AdminInsightCompanyLinks } from "@/components/admin/AdminInsightCompanyLinks";

export default function AdminInsightCompanyLinksPage() {
  return (
    <div className="admin-page-container">
      <div className="admin-page-heading">
        <div>
          <h1 className="admin-page-title">文章与公司</h1>
          <p className="admin-page-desc">选择文章，再添加关联公司。</p>
        </div>
      </div>
      <AdminInsightCompanyLinks />
    </div>
  );
}
