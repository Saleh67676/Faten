# سكريبت رفع التحديثات على GitHub
# اسم الملف: upload_to_github.ps1

Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "رفع التحديثات على GitHub" -ForegroundColor Green
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

# التحقق من وجود تغييرات
$status = git status --porcelain
if ([string]::IsNullOrWhiteSpace($status)) {
    Write-Host "✓ لا توجد تغييرات جديدة" -ForegroundColor Yellow
    exit 0
}

# عرض التغييرات
Write-Host "التغييرات المحددة للرفع:" -ForegroundColor Cyan
git status --short
Write-Host ""

# طلب تأكيد من المستخدم
$confirm = Read-Host "هل تريد متابعة الرفع؟ (y/n)"
if ($confirm -ne 'y' -and $confirm -ne 'Y') {
    Write-Host "تم الإلغاء" -ForegroundColor Red
    exit 0
}

# طلب رسالة الـ commit
Write-Host ""
$message = Read-Host "أدخل وصف التحديث (الرسالة)"
if ([string]::IsNullOrWhiteSpace($message)) {
    $message = "Update project with latest changes"
}

# تنفيذ الأوامر
Write-Host ""
Write-Host "جارٍ إضافة الملفات..." -ForegroundColor Cyan
git add .

Write-Host "جارٍ حفظ التغييرات..." -ForegroundColor Cyan
git commit -m $message

Write-Host "جارٍ الرفع إلى GitHub..." -ForegroundColor Cyan
git push origin main

Write-Host ""
Write-Host "=====================================" -ForegroundColor Green
Write-Host "✓ تم الرفع بنجاح!" -ForegroundColor Green
Write-Host "=====================================" -ForegroundColor Green
