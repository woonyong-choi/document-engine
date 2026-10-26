// 시험 전용 module 해석 hook. diagramplay가 설치되지 않은 호스트를 흉내 낸다.
export async function resolve(specifier, context, next) {
  if (specifier === 'diagramplay' || specifier.startsWith('diagramplay/')) {
    const error = new Error(`Cannot find package '${specifier}'`);
    error.code = 'ERR_MODULE_NOT_FOUND';
    throw error;
  }
  return next(specifier, context);
}
