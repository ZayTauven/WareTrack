from django.urls import path

from . import api

urlpatterns = [
    path('auth/login/', api.LoginView.as_view(), name='login'),
    path('auth/refresh/', api.RefreshView.as_view(), name='refresh'),
    path('auth/logout/', api.LogoutView.as_view(), name='logout'),
    path('me/', api.MeView.as_view(), name='me'),
]
