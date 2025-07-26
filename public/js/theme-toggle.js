// Theme Toggle Functionality
const themeToggle = document.getElementById('themeToggle');
const themeIcon = themeToggle.querySelector('i');

// Check for saved theme preference
const currentTheme = localStorage.getItem('theme') || 'light';
document.documentElement.setAttribute('data-theme', currentTheme);
updateIcon(currentTheme);

// Toggle theme function
function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateIcon(newTheme);
}

// Update icon based on theme
function updateIcon(theme) {
    if (theme === 'dark') {
        themeIcon.classList.remove('fa-moon');
        themeIcon.classList.add('fa-sun');
    } else {
        themeIcon.classList.remove('fa-sun');
        themeIcon.classList.add('fa-moon');
    }
}

// Event listeners
themeToggle.addEventListener('click', toggleTheme);

// Listen for system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    const newTheme = e.matches ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateIcon(newTheme);
});

// Notification Handling
const notificationBtn = document.querySelector('.notification-btn');
const notificationBadge = document.getElementById('notification-count');
const notificationList = document.getElementById('notification-list');
let lastNotificationCount = 0;

// Create notification popup container
const popupContainer = document.createElement('div');
popupContainer.className = 'notification-popup';
document.body.appendChild(popupContainer);

// Function to show popup notification
function showPopupNotification(notification) {
    const popup = document.createElement('div');
    popup.className = 'notification-popup';
    popup.innerHTML = `
        <button class="notification-popup-close">&times;</button>
        <div class="notification-popup-content">
            <i class="bi ${getNotificationIcon(notification.type)} notification-popup-icon"></i>
            <div class="notification-popup-text">
                <div class="notification-popup-title">New Notification</div>
                <div class="notification-popup-message">${notification.message}</div>
                <div class="notification-popup-time">${formatTime(notification.createdAt)}</div>
            </div>
        </div>
    `;

    // Add close button functionality
    const closeBtn = popup.querySelector('.notification-popup-close');
    closeBtn.addEventListener('click', () => {
        popup.classList.remove('show');
        setTimeout(() => popup.remove(), 300);
    });

    // Add to container and show
    popupContainer.appendChild(popup);
    setTimeout(() => popup.classList.add('show'), 100);

    // Auto remove after 5 seconds
    setTimeout(() => {
        popup.classList.remove('show');
        setTimeout(() => popup.remove(), 300);
    }, 5000);
}

// Function to update notification count
function updateNotificationCount(count) {
    if (notificationBadge) {
        if (count > 0) {
            notificationBadge.textContent = count;
            notificationBadge.style.display = "flex";
            notificationBadge.classList.add('new-notification');
            
            // Show popup for new notifications
            if (count > lastNotificationCount) {
                fetchNotificationList().then(notifications => {
                    if (notifications && notifications.length > 0) {
                        const newNotification = notifications[0]; // Show the latest notification
                        showPopupNotification(newNotification);
                    }
                });
            }
            
            lastNotificationCount = count;
            
            setTimeout(() => {
                notificationBadge.classList.remove('new-notification');
            }, 500);
        } else {
            notificationBadge.style.display = "none";
            lastNotificationCount = 0;
        }
    }
}

// Function to update notification list
function updateNotificationList(notifications) {
    if (notificationList) {
        if (!notifications || notifications.length === 0) {
            notificationList.innerHTML = `
                <li class="dropdown-item notification-item">
                    <div class="notification-content">
                        <i class="bi bi-info-circle text-primary"></i>
                        <div class="notification-text">
                            <p class="mb-0">No new notifications</p>
                            <small class="text-muted">You're all caught up!</small>
                        </div>
                    </div>
                </li>
            `;
        } else {
            notificationList.innerHTML = notifications.map(notification => `
                <li class="dropdown-item notification-item">
                    <div class="notification-content">
                        <i class="bi ${getNotificationIcon(notification.type)} text-primary"></i>
                        <div class="notification-text">
                            <p class="mb-0">${notification.message}</p>
                            <small class="text-muted">${formatTime(notification.createdAt)}</small>
                        </div>
                    </div>
                </li>
            `).join('');
        }
    }
    return notifications;
}

// Helper function to get appropriate icon based on notification type
function getNotificationIcon(type) {
    const icons = {
        'comment': 'bi-chat-dots',
        'like': 'bi-heart',
        'follow': 'bi-person-plus',
        'default': 'bi-bell'
    };
    return icons[type] || icons.default;
}

// Helper function to format timestamp
function formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString();
}

// Function to fetch unread notification count
async function fetchUnreadCount() {
    try {
        const response = await fetch('/notifications/unread-count');
        if (!response.ok) throw new Error('Network response was not ok');
        
        const data = await response.json();
        updateNotificationCount(data.count || 0);
    } catch (error) {
        console.error('Error fetching notification count:', error);
        if (notificationBadge) {
            notificationBadge.style.display = "none";
        }
    }
}

// Function to fetch notification list
async function fetchNotificationList() {
    try {
        const response = await fetch('/notifications');
        if (!response.ok) throw new Error('Network response was not ok');
        
        const data = await response.json();
        updateNotificationList(data.notifications || []);
    } catch (error) {
        console.error('Error fetching notification list:', error);
        updateNotificationList([]);
    }
}

// Poll for new notifications every 10 seconds
let notificationInterval = setInterval(fetchUnreadCount, 10000);

// Initial fetch
fetchUnreadCount();

// Clean up interval when page is hidden
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        clearInterval(notificationInterval);
    } else {
        fetchUnreadCount(); // Fetch immediately when page becomes visible
        notificationInterval = setInterval(fetchUnreadCount, 10000);
    }
});

// Fetch notifications when dropdown is opened
if (notificationBtn) {
    notificationBtn.addEventListener('shown.bs.dropdown', () => {
        fetchNotificationList();
    });
} 