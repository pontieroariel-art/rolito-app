// Color por índice de columna/chofer — compartido entre DespachoBoard.tsx y
// TransferOrderModal.tsx (antes vivía duplicado/inline en DespachoBoard.tsx).
const COL_COLORS = ['#00C2FF', '#FF6B6B', '#4ECDC4', '#FFE66D', '#C084FC', '#F97316', '#34D399', '#FB923C']

export function choferColor(idx: number) {
  return COL_COLORS[idx % COL_COLORS.length]
}
