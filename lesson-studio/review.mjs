// Вердикт модели проверяется вместе с замечаниями: ready при открытом major
// внутри отдельного блока не должен разрешать продолжение или публикацию.
export function hasOpenReviewIssues(review){
 const issues=[...(Array.isArray(review?.issues)?review.issues:[]),...(Array.isArray(review?.items)?review.items.flatMap(item=>Array.isArray(item.issues)?item.issues:[]):[])];
 return issues.some(issue=>['blocker','major'].includes(issue?.severity)&&!['fixed','closed','accepted'].includes(issue.status));
}
