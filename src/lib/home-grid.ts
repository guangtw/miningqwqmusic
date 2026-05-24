export type HomeGridPlan = {
  columns: number;
  count: number;
};

export function computeHomeGridPlan(containerWidth: number, itemCount: number, minCardWidth: number, gap: number): HomeGridPlan {
  const safeWidth = Math.max(0, containerWidth);
  const safeMinWidth = Math.max(1, minCardWidth);
  const safeGap = Math.max(0, gap);
  const columns = Math.max(1, Math.floor((safeWidth + safeGap) / (safeMinWidth + safeGap)));

  if (itemCount <= 0) {
    return {
      columns,
      count: 0
    };
  }

  const fullTwoRows = columns * 2;
  if (itemCount >= fullTwoRows) {
    return {
      columns,
      count: fullTwoRows
    };
  }

  if (itemCount >= columns) {
    return {
      columns,
      count: columns
    };
  }

  return {
    columns: itemCount,
    count: itemCount
  };
}
