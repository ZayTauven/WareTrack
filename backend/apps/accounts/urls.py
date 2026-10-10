from django.urls import path

from . import api, team_api

urlpatterns = [
    path('auth/login/', api.LoginView.as_view(), name='login'),
    path('auth/refresh/', api.RefreshView.as_view(), name='refresh'),
    path('auth/logout/', api.LogoutView.as_view(), name='logout'),
    path('me/', api.MeView.as_view(), name='me'),
    path('orgs/<slug:org>/members/', team_api.MembersView.as_view(), name='members'),
    path('orgs/<slug:org>/members/<uuid:user_id>/', team_api.MemberView.as_view(), name='member'),
    path('orgs/<slug:org>/invitations/', team_api.InvitationsView.as_view(), name='invitations'),
    path('orgs/<slug:org>/invitations/<uuid:invitation_id>/', team_api.InvitationView.as_view(), name='invitation'),
    path('invitations/<str:token>/', team_api.PublicInvitationView.as_view(), name='public-invitation'),
    path('invitations/<str:token>/accept/', team_api.AcceptInvitationView.as_view(), name='accept-invitation'),
]
