// Вердикт модели проверяется вместе с замечаниями: ready при открытом major
// внутри отдельного блока не должен разрешать продолжение или публикацию.
export function hasOpenReviewIssues(review){
 const issues=[...(Array.isArray(review?.issues)?review.issues:[]),...(Array.isArray(review?.items)?review.items.flatMap(item=>Array.isArray(item.issues)?item.issues:[]):[])];
 const unsupported=[...(Array.isArray(review?.factChecks)?review.factChecks:[]),...(Array.isArray(review?.questionChecks)?review.questionChecks:[])].some(check=>!['fixed','closed','accepted'].includes(check?.status)&&(check?.supported===false||check?.answerSupported===false||['unsupported','incorrect'].includes(check?.result)));
 return unsupported||issues.some(issue=>['blocker','major'].includes(issue?.severity)&&!['fixed','closed','accepted'].includes(issue.status));
}
