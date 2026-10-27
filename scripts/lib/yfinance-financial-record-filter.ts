export type YfinanceFinancialCandidate = {
  periodEnd: string;
  periodType: string;
  lineItem: string;
};

export function financialRecordKey(record: YfinanceFinancialCandidate) {
  return `${record.periodEnd}|${record.periodType}|${record.lineItem}`;
}

export function filterYfinanceFinancialRecords<T extends YfinanceFinancialCandidate>(
  records: Iterable<T>,
  options: {
    lineItems?: readonly string[];
    missingOnly?: boolean;
    existingKeys?: ReadonlySet<string>;
  } = {},
): T[] {
  const requestedLineItems = options.lineItems?.length
    ? new Set(options.lineItems)
    : null;

  return [...records].filter((record) => {
    if (requestedLineItems && !requestedLineItems.has(record.lineItem)) {
      return false;
    }
    if (options.missingOnly && options.existingKeys?.has(financialRecordKey(record))) {
      return false;
    }
    return true;
  });
}
