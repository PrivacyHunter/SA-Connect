# SA Connect

Build a modern, feature-rich Super-App frontend called "S&A Connect" that unifies messaging, social feeds, short-form video reels, long-form video streaming, and community channels into a seamless, high-performance web interface.



### Theme & Mode Switcher:

- App Name: "S&A Connect" (Show brand logo/title clearly in header/sidebar).

- Support dynamic Light Mode and Dark Mode toggling with a smooth transition switch in the navigation bar/settings.

- Dark Mode Palette: Dark slate (#0f172a / #090d16) background, subtle glassmorphism cards/panels, deep navy accents, and gold (#f59e0b) highlighting for active states and primary action buttons.

- Light Mode Palette: Clean crisp off-white background (#f8fafc), soft grey cards (#ffffff with clean borders), deep slate text, and gold/amber (#d97706) primary accents.

- Modern, clean typography and smooth micro-interactions (like, comment, bookmark animations).

- Fully responsive navigation: collapsible sidebar on desktop and a fixed bottom navigation bar on mobile devices.



### Core Navigation Sections:



1. Chat & Messages (WhatsApp / Telegram style):

   - Left sidebar with active chats list, search bar, unread badges, online status indicators, and tabs for "Direct Messages", "Groups", and "Channels".

   - Main view showing the active conversation with rich message bubbles (text, voice note player UI, image preview, file attachments).

   - Top bar in chat showing user/channel avatar, name, last seen status, theme toggle button, and quick action icons (Voice Call, Video Call, Search, Options).

   - Channel View: Public broadcasting UI with member counts, pinned announcements, and read-only media feed for subscribers.



2. Feed & Stories (Instagram / Facebook style):

   - Top horizontal row for "Stories / Status" with circular avatar borders and tap-to-view modal with progress bars.

   - Main feed featuring interactive posts with multi-image carousels, text posts, rich link previews, like/comment/share buttons, and comment drawer.



3. Short Videos / Reels (TikTok style):

   - Full-screen vertical scroll video feed player with snap scrolling.

   - Overlay controls on the right side: Author profile link, Heart (Like) counter, Comment trigger, Share button, and spinning audio album art thumbnail.

   - Bottom overlay displaying creator username, caption, hashtags, and background music track name.



4. Video Hub (YouTube style):

   - Grid layout of long-form video thumbnails with video title, duration overlay badge, channel avatar, view count, and time uploaded.

   - Video Player Page component with video player window, action bar (Like/Dislike, Share, Save, Subscribe button), detailed collapsible description, and recommended side-videos list.



5. Global Profile & Creator Hub:

   - User profile page with banner, avatar, follower/following stats, bio, and tabbed grids: "Posts", "Reels", "Videos", and "Liked".



### Technical & Architecture Requirements:

- Build modular React components using Tailwind CSS and Lucide React icons.

- Implement theme switching using Tailwind's dark mode classes or a React Context provider (`useTheme`).

- Create interactive mock state management using React hooks (`useState`, `useContext`) so all tabs, dark/light toggle, navigation, modals, and interactions work smoothly in the preview.

- Include rich dummy JSON data for chats, feed posts, short video clips, and long video cards so the app looks complete and responsive immediately.



Kuch bhi dummy na ho everything real ho database firebase ka lgao

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/609157da-ede1-4b42-a6a3-d7dded1eb049).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
