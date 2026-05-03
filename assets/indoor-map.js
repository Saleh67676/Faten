// =================================================================
// UQU Indoor Map Viewer - واجهة عرض الخريطة للطلاب
// =================================================================

class MapViewer {
  constructor(containerId, imageUrl, mapData) {
    this.container = document.getElementById(containerId);
    this.imageUrl = imageUrl;
    this.mapData = mapData;
    this.image = new Image();
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.activeRoom = null;
    
    this.init();
  }

  init() {
    // 1. تجهيز الحاوية
    this.container.style.position = 'relative';
    this.container.style.overflow = 'hidden';
    this.container.style.width = '100%';
    this.container.style.height = '100%'; // أو أي ارتفاع مناسب

    // 2. تجهيز الصورة
    this.image.src = this.imageUrl;
    this.image.style.width = '100%';
    this.image.style.display = 'block';
    
    // 3. تجهيز الـ SVG
    this.svg.style.position = 'absolute';
    this.svg.style.top = '0';
    this.svg.style.left = '0';
    this.svg.style.width = '100%';
    this.svg.style.height = '100%';

    this.container.appendChild(this.image);
    this.container.appendChild(this.svg);

    // عندما تحمل الصورة، نقوم بضبط مقاسات الـ SVG ورسم القاعات
    this.image.onload = () => {
      this.svg.setAttribute('viewBox', `0 0 ${this.image.naturalWidth} ${this.image.naturalHeight}`);
      this.renderMap();
    };
  }

  renderMap() {
    const w = this.image.naturalWidth;
    const h = this.image.naturalHeight;

    this.mapData.forEach(item => {
      // إخفاء الممرات (Corridors) من العرض المباشر لأنها للملاحة فقط
      if (item.type === 'corridor') return; 

      // 1. رسم المضلع (القاعة)
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      
      // تحويل النسب المئوية إلى إحداثيات حقيقية تتناسب مع الصورة
      const actualPoints = item.points.split(' ').map(point => {
        const [px, py] = point.split(',');
        return `${(px * w) / 100},${(py * h) / 100}`;
      }).join(' ');

      polygon.setAttribute('points', actualPoints);
      polygon.setAttribute('data-id', item.id);
      
      // التنسيق الافتراضي (شفاف تماماً حتى يظهر المخطط الأساسي)
      polygon.style.fill = 'transparent';
      polygon.style.stroke = 'transparent';
      polygon.style.strokeWidth = '3';
      polygon.style.cursor = 'pointer';
      polygon.style.transition = 'all 0.3s ease';

      // تأثيرات التمرير والضغط
      polygon.addEventListener('mouseenter', () => {
        if (this.activeRoom !== polygon) {
          polygon.style.fill = `${item.color}33`; // 33 يعني شفافية ~20%
          polygon.style.stroke = item.color;
        }
      });
      
      polygon.addEventListener('mouseleave', () => {
        if (this.activeRoom !== polygon) {
          polygon.style.fill = 'transparent';
          polygon.style.stroke = 'transparent';
        }
      });

      polygon.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectRoom(polygon, item);
      });

      group.appendChild(polygon);

      // 2. رسم الأبواب (اختياري: يمكنك إظهارها أو إخفاؤها حسب الحاجة)
      if (item.doors && item.doors.length > 0) {
        item.doors.forEach(door => {
          const doorCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          doorCircle.setAttribute('cx', (door.x * w) / 100);
          doorCircle.setAttribute('cy', (door.y * h) / 100);
          doorCircle.setAttribute('r', '4');
          doorCircle.setAttribute('fill', '#f59e0b');
          doorCircle.setAttribute('stroke', '#fff');
          doorCircle.setAttribute('stroke-width', '1.5');
          // إخفاء الأبواب افتراضياً (تظهر فقط عند تحديد القاعة)
          doorCircle.style.opacity = '0'; 
          doorCircle.classList.add(`doors-${item.id}`);
          doorCircle.style.transition = 'opacity 0.3s';
          group.appendChild(doorCircle);
        });
      }

      this.svg.appendChild(group);
    });

    // عند الضغط على أي مكان فارغ بالخريطة، يتم إلغاء التحديد
    this.svg.addEventListener('click', () => this.deselectAll());
  }

  selectRoom(polygonNode, itemData) {
    this.deselectAll();
    
    this.activeRoom = polygonNode;
    
    // إضاءة القاعة بقوة عند التحديد
    polygonNode.style.fill = `${itemData.color}66`; // شفافية 40%
    polygonNode.style.stroke = itemData.color;
    polygonNode.style.strokeWidth = '5';
    
    // إظهار أبواب القاعة المحددة
    const doors = this.svg.querySelectorAll(`.doors-${itemData.id}`);
    doors.forEach(d => d.style.opacity = '1');

    // إرسال حدث للواجهة لعرض اسم القاعة في البطاقة السفلية للموبايل
    console.log("تم تحديد:", itemData.label);
    
    // مثال: تحديث بطاقة الـ HTML
    // document.getElementById('room-title').textContent = itemData.label;
  }

  deselectAll() {
    if (this.activeRoom) {
      this.activeRoom.style.fill = 'transparent';
      this.activeRoom.style.stroke = 'transparent';
      this.activeRoom.style.strokeWidth = '3';
      this.activeRoom = null;
    }
    // إخفاء كل الأبواب
    const allDoors = this.svg.querySelectorAll('circle');
    allDoors.forEach(d => d.style.opacity = '0');
  }

  // دالة للبحث عن قاعة من مربع البحث
  searchAndFocus(roomId) {
    const targetPolygon = this.svg.querySelector(`polygon[data-id="${roomId}"]`);
    const itemData = this.mapData.find(r => r.id === roomId);
    if (targetPolygon && itemData) {
      this.selectRoom(targetPolygon, itemData);
      // يمكن إضافة كود هنا لعمل Zoom/Pan نحو القاعة
    }
  }
}

// ── طريقة التشغيل ─────────────────────────────────────
// عند تحميل الصفحة:
// const myMap = new MapViewer('floorplanContainer', 'assets/base-map.jpg', MAP_DATA);