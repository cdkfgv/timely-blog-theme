if (api.originEntity.isDeleted) {
    return;
}
if (api.originEntity.name != "publish") { return }
const note = api.originEntity.getNote();
const publishStatus = note.getLabelValue("publish");
if (publishStatus === "true") {
    const content = note.getContent();
    note.setLabel("blogSummary", extractTextFromHTML(content));
    const date = note.getLabelValue("blogDate");
    if(date === '' || date === null){
        note.setLabel("blogDate", getFormattedDate());
    }
}

note.save();

function extractTextFromHTML(html) {
    var text = html.replace(/<[^>]*>/g, '');
    text = text.replace(/\s+/g, '');

    var extractedText = text.substring(0, 120);

    return `${extractedText}...`;
}
function getFormattedDate() {
  const date = new Date();
  const year = date.getFullYear();
  // 月份从0开始，需要+1，并使用padStart补零
  const month = String(date.getMonth() + 1).padStart(2, '0');
  // 使用padStart确保日期为两位数
  const day = String(date.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}