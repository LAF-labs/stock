update public.industry_taxonomy_map
set canonical_industry_key = '정보기술_반도체',
    canonical_industry_name = '반도체',
    confidence = greatest(confidence, 0.95),
    updated_at = now()
where taxonomy = 'profile_primary'
  and source_key = 'KR:정보기술:정보기술_반도체_제조업';

update public.industry_taxonomy_map
set canonical_industry_key = '금융_보험',
    canonical_industry_name = '보험',
    confidence = greatest(confidence, 0.95),
    updated_at = now()
where taxonomy = 'profile_primary'
  and source_key = 'KR:금융:금융_보험업';
