"use client";

export default function SkeletonBlock({ className = "" }: { className?: string }) {
  return <span className={`skeleton-block ${className}`} aria-hidden="true" />;
}
