BorrowBox backend API (base URL = import.meta.env.VITE_API_URL, default http://localhost:5000)
Logged-in routes need header: Authorization: Bearer <token>. Errors look like { "error": "message" }.

AUTH
POST /api/auth/register {name,email,phone,password,location} -> {user}
POST /api/auth/login {email,password} -> {token,user:{id,name,email,role}}
GET  /api/auth/me (auth) -> {user:{id,name,email,phone,location,role,is_verified,trust_score,created_at}}

CATEGORIES
GET /api/categories -> {categories:[{id,name}]}

ITEMS
GET /api/items?category=&q=&location=&available=true -> {items:[{id,title,item_condition,location,deposit_amount,max_days,is_available,category,owner_name,owner_trust,image_url}]}
GET /api/items/mine (auth) -> {items:[{id,title,is_available,category,created_at}]}
GET /api/items/:id -> {item:{id,owner_id,title,description,item_condition,location,deposit_amount,max_days,is_available,category,owner_name,owner_trust,owner_verified,images:[urls]}}
POST /api/items (auth) {title,description,category_id,item_condition,location,deposit_amount,max_days,image_urls:[]} -> {item}
PUT /api/items/:id (auth, owner) any of the above fields plus is_available -> {item}
DELETE /api/items/:id (auth, owner) -> {deleted:true}

UPLOADS
POST /api/uploads (auth) multipart field "images" (max 5 files, JPG/PNG/WebP, 5MB each) -> {urls:[]}

BORROW REQUESTS
POST /api/requests (auth) {item_id,start_date,return_date,purpose} dates as YYYY-MM-DD -> {request:{id,item_id,status}}
GET  /api/requests/mine (auth) -> {requests:[{id,status,purpose,start_date,return_date,item_id,item_title,owner_name}]}
GET  /api/requests/incoming (auth) -> {requests:[{id,status,purpose,start_date,return_date,item_id,item_title,borrower_id,borrower_name,borrower_trust}]}
PUT  /api/requests/:id/:action (auth) action = approve|reject (owner), cancel (borrower, before approval), handover (owner), return (borrower), complete (owner)
Status flow: requested -> approved -> active -> returned -> completed (or rejected / cancelled)

REVIEWS
POST /api/reviews (auth) {request_id,rating 1-5,comment} only after status completed
GET  /api/reviews/user/:id -> {user:{id,name,location,is_verified,trust_score,created_at}, review_count, reviews:[{id,rating,comment,created_at,reviewer_name}]}

NOTIFICATIONS
GET /api/notifications (auth) -> {unread_count, notifications:[{id,message,request_id,is_read,created_at}]}
PUT /api/notifications/read-all (auth)
PUT /api/notifications/:id/read (auth)