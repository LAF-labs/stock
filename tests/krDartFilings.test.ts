import test from "node:test";
import assert from "node:assert/strict";

import { buildDartListUrl, dartDisclosureToFiling } from "../src/lib/krDartFilings";

test("builds OpenDART list URL for one disclosure day", () => {
  const url = buildDartListUrl("https://opendart.fss.or.kr", {
    apiKey: "test-key",
    date: "20260615",
    corpClass: "Y",
    pageNo: 2,
  });

  assert.equal(
    url,
    "https://opendart.fss.or.kr/api/list.json?crtfc_key=test-key&bgn_de=20260615&end_de=20260615&corp_cls=Y&page_no=2&page_count=100&sort=date&sort_mth=desc"
  );
});

test("converts DART disclosures into stock filing rows", () => {
  const filing = dartDisclosureToFiling({
    corp_code: "00126380",
    corp_name: "삼성전자",
    stock_code: "005930",
    corp_cls: "Y",
    report_nm: "[삼성전자] 유상증자결정",
    rcept_no: "20260615000001",
    rcept_dt: "20260615",
    flr_nm: "삼성전자",
    rm: "",
  }, new Set(["005930"]));

  assert.ok(filing);
  assert.equal(filing.ticker, "KR:005930");
  assert.equal(filing.cik, "00126380");
  assert.equal(filing.accessionNumber, "20260615000001");
  assert.equal(filing.formType, "유상증자결정");
  assert.equal(filing.sourceUrl, "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260615000001");
  assert.match(filing.summaryKo, /새 주식을 발행/);
  assert.equal(filing.facts.source, "DART");
  assert.equal(filing.facts.reportName, "유상증자결정");
});

test("ignores DART rows outside the local stock universe", () => {
  const filing = dartDisclosureToFiling({
    corp_code: "99999999",
    corp_name: "비상장",
    stock_code: "999999",
    corp_cls: "E",
    report_nm: "기타공시",
    rcept_no: "20260615000002",
    rcept_dt: "20260615",
  }, new Set(["005930"]));

  assert.equal(filing, undefined);
});
