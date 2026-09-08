const GUIDE_RESERVATION_CLASS = 'efetivo-guide-pending';

type GuideDocument = Pick<Document, 'body'>;

export function reserveEfetivoGuide(documentRef: GuideDocument = document) {
  const classList = documentRef.body.classList;
  if (classList.contains('driver-active') || classList.contains(GUIDE_RESERVATION_CLASS)) {
    return false;
  }
  classList.add(GUIDE_RESERVATION_CLASS);
  return true;
}

export function releaseEfetivoGuide(documentRef: GuideDocument = document) {
  documentRef.body.classList.remove(GUIDE_RESERVATION_CLASS);
}
