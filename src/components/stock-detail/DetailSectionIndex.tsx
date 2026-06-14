"use client";

type DetailSectionIndexProps<SectionId extends string> = {
  sections: ReadonlyArray<{ id: SectionId; label: string; isNew?: boolean }>;
  activeSection: SectionId;
  onSelect: (id: SectionId) => void;
};

export default function DetailSectionIndex<SectionId extends string>({
  sections,
  activeSection,
  onSelect,
}: DetailSectionIndexProps<SectionId>) {
  return (
    <nav className="stock-detail-index" aria-label="상세 화면 목차">
      <span>목차</span>
      <div>
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            className={activeSection === section.id ? "active" : undefined}
            aria-current={activeSection === section.id ? "true" : undefined}
            onClick={() => onSelect(section.id)}
          >
            {section.isNew ? <i aria-label="최근 1주일 내 새 공시" /> : null}
            {section.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
